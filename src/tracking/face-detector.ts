// Face detector (yolov9s-face) on onnxruntime-web. WebGPU-only by product
// decision: this model at 960 input costs ~600 ms/tile on wasm single-thread,
// unusable at pass cadence - machines without a WebGPU adapter do not get the
// faces checkbox at all (gated in the UI; the worker refuses a wasm fallback).
//
// Model: lindevs/yolov9-face 1.0.0 yolov9s-face-lindevs.pt (GPL-3.0 - the
// repo's MIT badge does not survive the GPL-3.0 WongKinYiu base weights it was
// fine-tuned from; license shipped next to the model), re-exported by us:
// ultralytics ONNX at STATIC imgsz=960, then fp16 weight conversion with fp32
// IO and Resize kept fp32 (onnxconverter-common chokes on Resize otherwise).
// sha256 of the shipped fp16 file:
// e3c117a93584f7d3cf595f97df7391c3ad4c4a7e88b8e38149e1b18014e4005d
//
// Why this model and why 960: bake-off on real 4K dashcam frames
// (private/research/face-detector-spike/). The previous
// 232 KB YuNet false-fired on car fronts, wheels, tree crowns and building
// facades - persistent FPs that survived temporal corroboration and needed
// geometry-filter crutches. yolov9s produced ZERO detections on all those
// sites; at 640 input its small-face recall trailed YuNet (a 30 px face lands
// below the P3 stride floor after the ~0.5x tile letterbox), at an effective
// ~960 scale it beat YuNet outright (10 verified real faces vs 3, including
// drivers behind windshields). Known residual FP class: traffic-light lenses /
// red-man pictograms (small, mid-frame, persistent) - accepted as the cheap
// failure; nothing geometric separates them from a face.
//
// Output decode: ultralytics export, [1, 5, N] channels-first (cx, cy, w, h,
// score) in input pixels, no in-graph NMS - suppressOverlaps handles both
// model duplicates and cross-tile seams.
//
// Runs in a worker. No logging - per-frame hot path.

import {
    letterboxInto,
    type LetterboxMap,
    type RawDetection,
    suppressOverlaps,
    type TileRect,
    tileRects,
} from "./detect-common.js";
import { loadOrt, type OrtModule, type OrtRuntime } from "./ort-runtime.js";

/** The re-export's static input side (see header). */
const INPUT_SIZE = 960;
/** YOLO letterbox convention the model was trained with: centered, 114-gray. */
const LETTERBOX_FILL = "rgb(114,114,114)";
/** Raw score floor - junk cut only. Bake-off band: real faces sit at 0.2-0.66
 *  at this scale, the residual FP class (traffic-light lenses) tops out at
 *  0.59; the 0.2-0.25 sliver is flicker junk plus tiny/far faces below the
 *  identifiability bar (FACE_MIN_WIDTH_PX). The PRODUCT floor - what may seed
 *  a track or count as confirmation evidence - is DETECT_SEED_SCORE_MIN in
 *  tracker-worker.ts; the band between the two floors is returned on purpose,
 *  it re-anchors already-live tracks (see the seed-floor note there). A
 *  PRINTED face on a billboard scores like a real one: no threshold separates
 *  it (the detector is right - it IS a face). */
export const FACE_SCORE_MIN = 0.25;
/** Identifiability floor, native px: a face narrower than this cannot be
 *  recognized by a human (crop-sheet review in
 *  face-detector-spike/results-blazeface: even 9-17 px faces read as a person
 *  but not an identity) - covering it is not a privacy need, and the tiny-box
 *  band is where the residual FP classes (traffic-light lenses, pictograms)
 *  live. */
export const FACE_MIN_WIDTH_PX = 20;
/** Duplicate suppression across tiles and model leftovers. */
const NMS_IOU = 0.45;

export class FaceDetector {
    /** Reused letterbox target - one allocation per detector. */
    private readonly scratch = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);

    private constructor(
        private readonly ort: OrtModule,
        private readonly session: Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>,
    ) {}

    /** Loads the model and prepares a session on the given runtime. `wasmDir`
     *  must host the matching ort binaries (see vite-plugins/tracker-assets). The
     *  caller enforces the webgpu-only rule - a create on "wasm" would work
     *  but is never requested (see header). */
    static async create(runtime: OrtRuntime, modelUrl: string, wasmDir: string): Promise<FaceDetector> {
        const ort = await loadOrt(runtime, wasmDir);
        const session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: [runtime],
            // Errors only - same per-node-fallback warning noise as the plate
            // detector (see there).
            logSeverityLevel: 3,
        });
        return new FaceDetector(ort, session);
    }

    /** All face candidates over `tiles` (default: the full grid), in frame
     *  pixels, deduped across tiles, scores >= FACE_SCORE_MIN. */
    async detect(
        frame: CanvasImageSource,
        frameW: number,
        frameH: number,
        tiles: readonly TileRect[] = tileRects(frameW, frameH),
    ): Promise<RawDetection[]> {
        const detections: RawDetection[] = [];
        // Pipelined tiles - same shape and rationale as PlateDetector.detect:
        // pack the next tile on the CPU while the current one runs on the GPU,
        // one inference in flight at a time.
        let inFlight: { outputs: ReturnType<FaceDetector["session"]["run"]>; lb: LetterboxMap; tile: TileRect } | null =
            null;
        const collect = async (): Promise<void> => {
            if (!inFlight) return;
            const { outputs, lb, tile } = inFlight;
            inFlight = null;
            const out = (await outputs)[this.session.outputNames[0]!];
            if (!out) return;
            // [1, 5, N] channels-first: cx, cy, w, h, score in input pixels.
            const data = out.data as Float32Array;
            const n = out.dims[2]!;
            for (let i = 0; i < n; i++) {
                const score = data[4 * n + i]!;
                if (!(score >= FACE_SCORE_MIN)) continue;
                const cx = data[i]!;
                const cy = data[n + i]!;
                const w = data[2 * n + i]!;
                const h = data[3 * n + i]!;
                if (w / lb.scale < FACE_MIN_WIDTH_PX) continue;
                detections.push({
                    x: (cx - w / 2 - lb.dx) / lb.scale + tile.sx,
                    y: (cy - h / 2 - lb.dy) / lb.scale + tile.sy,
                    w: w / lb.scale,
                    h: h / lb.scale,
                    score,
                });
            }
        };
        for (const tile of tiles) {
            const lb = letterboxInto(
                this.scratch,
                frame,
                tile.sx,
                tile.sy,
                tile.sw,
                tile.sh,
                INPUT_SIZE,
                LETTERBOX_FILL,
                true,
            );
            const tensor = this.toTensor();
            await collect();
            inFlight = { outputs: this.session.run({ [this.session.inputNames[0]!]: tensor }), lb, tile };
        }
        await collect();
        return suppressOverlaps(detections, NMS_IOU);
    }

    /** RGB planes, /255 (the ultralytics export's expected normalization). */
    private toTensor(): InstanceType<OrtModule["Tensor"]> {
        const ort = this.ort;
        const ctx = this.scratch.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("face-detector: scratch ctx unavailable");
        const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
        const n = INPUT_SIZE * INPUT_SIZE;
        const data = new Float32Array(3 * n);
        for (let i = 0; i < n; i++) {
            data[i] = rgba[i * 4]! / 255;
            data[n + i] = rgba[i * 4 + 1]! / 255;
            data[2 * n + i] = rgba[i * 4 + 2]! / 255;
        }
        return new ort.Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    }
}

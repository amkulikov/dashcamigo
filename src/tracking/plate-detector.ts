// License-plate detector on onnxruntime-web. WebGPU-only by product decision
// (shared with the face detector - see blur-detect.ts): the wasm path costs
// ~140 ms per 512 inference single-thread, ~6x realtime at pass cadence -
// machines without an adapter do not get the plates checkbox at all.
//
// Model: ankandrew/open-image-models yolo-v9-t-512-license-plates-end2end.onnx
// (MIT, 7.8 MB fp32, sha256
// 746fdd358ec110418775d7c9d8d07910d48b1a21471f92bf4421f6510d6daade, from the
// repo's GitHub release assets). "end2end" = NMS is inside the graph via the
// standard NonMaxSuppression op, so the output is already a short list of
// boxes - no candidate decoding here. Validated against real dashcam frames in
// private/research/plate-detector-spike/ (detection floor, tiling,
// latency; ~20 ms per 512 inference on webgpu).
//
// Contract: detect() runs the model over (a subset of) an overlapping tile
// grid (small plates vanish in a whole-frame letterbox - see detect-common.ts),
// remaps boxes to frame pixels and suppresses cross-tile duplicates.
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

/** The model variant's static input side. */
const INPUT_SIZE = 512;
/** YOLO letterbox convention the model was trained with: centered, 114-gray. */
const LETTERBOX_FILL = "rgb(114,114,114)";
/** Raw score floor - junk cut only. Spike bands: angled-but-readable plates
 *  ~0.13, frontal readable 0.4-0.85; below 0.25 the field is dominated by
 *  flicker junk (windows, bollards, fences). The PRODUCT floor - what may seed
 *  a track or count as confirmation evidence - is DETECT_SEED_SCORE_MIN in
 *  tracker-worker.ts; the band between the two floors is returned on purpose,
 *  it re-anchors already-live tracks (see the seed-floor note there). */
export const PLATE_SCORE_MIN = 0.25;
/** Cross-tile duplicate suppression. */
const DEDUPE_IOU = 0.5;

/** Whole-vehicle false-positive gate: the model sometimes claims an entire
 *  side-on car as one "plate" - a PERSISTENT detection temporal corroboration
 *  cannot kill (it does not flicker; it parks in the frame for seconds). Real
 *  plates are bounded by optics: at a dashcam's wide FOV a plate wider than
 *  ~15% of the frame puts the camera well under a meter from the bumper, and
 *  the spike's readable plates top out far below both caps. Anything bigger is
 *  bodywork - drop it before it can seed a track. (Aspect is deliberately NOT
 *  gated: a side-on car is ~2.5:1, same as a US plate.) */
export const PLATE_MAX_WIDTH_FRAC = 0.15;
export const PLATE_MAX_AREA_FRAC = 0.015;

/** True when a raw box is geometrically plausible as a license plate (see the
 *  caps above). Degenerate frame dims pass - corroboration owns those. */
export function plateBoxPlausible(box: RawDetection, frameW: number, frameH: number): boolean {
    if (!(frameW > 0) || !(frameH > 0)) return true;
    return box.w / frameW <= PLATE_MAX_WIDTH_FRAC && (box.w * box.h) / (frameW * frameH) <= PLATE_MAX_AREA_FRAC;
}

export class PlateDetector {
    /** Reused letterbox target - one allocation per detector. */
    private readonly scratch = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);

    private constructor(
        private readonly ort: OrtModule,
        private readonly session: Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>,
    ) {}

    /** Loads the model and prepares a session on the given runtime. `wasmDir`
     *  must host the matching ort binaries (see vite-plugins/tracker-assets). The
     *  caller enforces the webgpu-only rule (see header) - a create on "wasm"
     *  would work but is never requested. */
    static async create(runtime: OrtRuntime, modelUrl: string, wasmDir: string): Promise<PlateDetector> {
        const ort = await loadOrt(runtime, wasmDir);
        const session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: [runtime],
            // Errors only: on webgpu ORT warns about per-node CPU fallback (the
            // in-graph NMS - expected) straight to console.error, which both
            // noises real consoles and trips the fail-loud e2e invariant.
            logSeverityLevel: 3,
        });
        return new PlateDetector(ort, session);
    }

    /** All plate candidates over `tiles` (default: the full grid), in frame
     *  pixels, deduped across tiles, scores >= PLATE_SCORE_MIN, implausibly
     *  large boxes dropped (plateBoxPlausible). */
    async detect(
        frame: CanvasImageSource,
        frameW: number,
        frameH: number,
        tiles: readonly TileRect[] = tileRects(frameW, frameH),
    ): Promise<RawDetection[]> {
        const detections: RawDetection[] = [];
        // Pipelined tiles: the NEXT tile's letterbox + tensor pack (CPU) runs
        // while the CURRENT tile's inference is in flight on the GPU - the
        // pack copies the scratch canvas into a fresh Float32Array, so the
        // scratch is reusable immediately. One inference in flight at a time
        // (ort sessions are not reentrant).
        let inFlight: {
            outputs: ReturnType<PlateDetector["session"]["run"]>;
            lb: LetterboxMap;
            tile: TileRect;
        } | null = null;
        const collect = async (): Promise<void> => {
            if (!inFlight) return;
            const { outputs, lb, tile } = inFlight;
            inFlight = null;
            const out = (await outputs)[this.session.outputNames[0]!];
            if (!out) return;
            // Rows of [batch, x1, y1, x2, y2, class, score] in input pixels.
            const data = out.data as Float32Array;
            const cols = out.dims[out.dims.length - 1]!;
            for (let r = 0; r * cols < data.length; r++) {
                const score = data[r * cols + 6]!;
                if (!(score >= PLATE_SCORE_MIN)) continue;
                const x1 = (data[r * cols + 1]! - lb.dx) / lb.scale + tile.sx;
                const y1 = (data[r * cols + 2]! - lb.dy) / lb.scale + tile.sy;
                const x2 = (data[r * cols + 3]! - lb.dx) / lb.scale + tile.sx;
                const y2 = (data[r * cols + 4]! - lb.dy) / lb.scale + tile.sy;
                const box: RawDetection = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, score };
                if (plateBoxPlausible(box, frameW, frameH)) detections.push(box);
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
        return suppressOverlaps(detections, DEDUPE_IOU);
    }

    /** RGB planes, /255 (the YOLO export's expected normalization). */
    private toTensor(): InstanceType<OrtModule["Tensor"]> {
        const ort = this.ort;
        const ctx = this.scratch.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("plate-detector: scratch ctx unavailable");
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

// License-plate detector on onnxruntime-web. WebGPU-only by product decision
// (shared with the face detector - see blur-detect.ts): the wasm path misses the
// detection-pass budget, so machines without an adapter do not get the plates
// checkbox at all.
//
// Model: ankandrew/open-image-models yolo-v9-s-608-license-plates-end2end.onnx
// (MIT), converted to FP16 compute with FP32 input, postprocess and output; exact
// source/conversion hashes are in public/models/plate/NOTICE. "end2end" means NMS
// is inside the graph via the standard NonMaxSuppression op, so the output is
// already a short list of boxes. On 31 local day/night dashcam stills at the 0.6
// product seed floor, this variant added seven boxes over t512 and all seven were
// manually labeled as plates; no additional false positive appeared. Median
// WebGPU inference was 36.5 ms over 184 tiles. This is a small targeted
// regression sample, not an exhaustive precision/recall benchmark.
//
// Contract: detect() runs the model over (a subset of) an overlapping tile
// grid (small plates vanish in a whole-frame letterbox - see detect-common.ts),
// remaps boxes to frame pixels and suppresses cross-tile duplicates.
//
// Runs in a worker. No logging - per-frame hot path.

import {
    letterboxInto,
    type LetterboxMap,
    packRgbPlanarNormalized,
    type RawDetection,
    suppressOverlaps,
    type TileRect,
    tileRects,
} from "./detect-common.js";
import { loadOrt, type OrtModule, type OrtRuntime } from "./ort-runtime.js";

type OrtTensor = InstanceType<OrtModule["Tensor"]>;

interface InputSlot {
    readonly data: Float32Array;
    readonly tensor: OrtTensor;
}

/** The model variant's static input side. */
const INPUT_SIZE = 608;
/** YOLO letterbox convention the model was trained with: centered, 114-gray. */
const LETTERBOX_FILL = "rgb(114,114,114)";
/** Raw score floor - junk cut only. The PRODUCT floor - what may seed a track or
 *  count as confirmation evidence - is DETECT_SEED_SCORE_MIN in
 *  tracker-worker.ts. The band between the two floors is returned on purpose:
 *  it may re-anchor an already-live track but cannot create one. Only the 0.6+
 *  delta was manually labeled; this lower band remains exploratory. */
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
    /** Two slots are required by the one-run-deep CPU/GPU pipeline: while ORT
     *  owns one tensor, the next tile is packed into the other. */
    private readonly inputSlots: readonly [InputSlot, InputSlot];

    private constructor(
        ort: OrtModule,
        private readonly session: Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>,
    ) {
        const makeSlot = (): InputSlot => {
            const data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
            return { data, tensor: new ort.Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
        };
        this.inputSlots = [makeSlot(), makeSlot()];
    }

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
        // pack writes the other ping-pong slot, so the scratch is reusable
        // immediately. One inference in flight at a time (ort sessions are not
        // reentrant).
        let inFlight: {
            outputs: ReturnType<PlateDetector["session"]["run"]>;
            lb: LetterboxMap;
            tile: TileRect;
        } | null = null;
        const collect = async (): Promise<void> => {
            if (!inFlight) return;
            const { outputs, lb, tile } = inFlight;
            inFlight = null;
            let resolved: Awaited<typeof outputs> | null = null;
            try {
                resolved = await outputs;
                const out = resolved[this.session.outputNames[0]!];
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
            } finally {
                if (resolved) {
                    for (const tensor of Object.values(resolved)) tensor.dispose();
                }
            }
        };
        try {
            for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
                const tile = tiles[tileIdx]!;
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
                const tensor = this.toTensor(this.inputSlots[tileIdx & 1]!);
                // Slot N-2 is no longer owned by ORT after collect resolves, so
                // it is safe for the next iteration to reuse it.
                await collect();
                inFlight = { outputs: this.session.run({ [this.session.inputNames[0]!]: tensor }), lb, tile };
            }
            await collect();
        } catch (error) {
            // If canvas readback/packing failed while the previous run was
            // pending, still drain and dispose that run's outputs.
            try {
                await collect();
            } catch {
                // Preserve the original failure.
            }
            throw error;
        }
        return suppressOverlaps(detections, DEDUPE_IOU);
    }

    /** RGB planes, /255 (the YOLO export's expected normalization). */
    private toTensor(slot: InputSlot): OrtTensor {
        const ctx = this.scratch.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("plate-detector: scratch ctx unavailable");
        const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
        packRgbPlanarNormalized(rgba, slot.data);
        return slot.tensor;
    }
}

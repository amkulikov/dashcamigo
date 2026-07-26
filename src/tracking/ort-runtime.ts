// Loader for the onnxruntime-web runtime the detectors run on. Two builds:
//
// - "wasm": the plain single-thread WASM EP - works everywhere, the floor of
//   performance (multithread needs crossOriginIsolated, which would break the
//   external map-tile fetches - same trade as vittrack.ts).
// - "webgpu": ort's WebGPU EP (the asyncify wasm build). Measured ~7x faster
//   per detector inference on an integrated GPU (20 ms vs 139 ms for the 512
//   plate model, identical boxes; private/research/
//   plate-detector-spike/spike-webgpu.js). In-graph NMS falls back to CPU
//   per-node - expected, harmless.
//
// The two entries are separate module instances with separate env config; the
// dead one is never fetched (dynamic import). vittrack loads through here too
// (VitTrackerSession.create takes an OrtRuntime): the Follow pass on "wasm", the
// detection pass on "webgpu" so the tracker reuses the detectors' asyncify
// runtime instead of pulling the plain wasm build a second time.
//
// Runs in a worker. No logging - loaded from per-pass hot paths.

export type OrtRuntime = "webgpu" | "wasm";

/** Both bundles expose the same API; the wasm entry's types stand for both. */
export type OrtModule = typeof import("onnxruntime-web/wasm");

const cached = new Map<OrtRuntime, OrtModule>();

/** Loads (once per runtime) and configures the requested ort build. `wasmDir`
 *  must host the matching binaries (see vite-plugins/tracker-assets.ts). */
export async function loadOrt(runtime: OrtRuntime, wasmDir: string): Promise<OrtModule> {
    const hit = cached.get(runtime);
    if (hit) return hit;
    const module = (
        runtime === "webgpu" ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm")
    ) as OrtModule;
    module.env.wasm.wasmPaths = wasmDir;
    module.env.wasm.numThreads = 1;
    cached.set(runtime, module);
    return module;
}

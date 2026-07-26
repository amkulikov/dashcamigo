// Minimal WebGPU surface for the detector-runtime probe (ui/blur-detect.ts).
// Deliberately NOT @webgpu/types: the app never touches the GPU API itself -
// onnxruntime-web does - so one optional adapter probe does not justify a
// types dependency. Extend only if real GPU calls ever land in project code.

interface Navigator {
    readonly gpu?: {
        requestAdapter(): Promise<object | null>;
    };
}

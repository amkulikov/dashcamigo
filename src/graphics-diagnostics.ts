export interface GraphicsDiagnostics {
    context: "webgl2" | "webgl" | "unavailable";
    vendor: string | null;
    renderer: string | null;
    unmaskedVendor: string | null;
    unmaskedRenderer: string | null;
    error: string | null;
}

/** Only collected for the local report; WebGL's renderer does not identify the video encoder. */
export function collectGraphicsDiagnostics(): GraphicsDiagnostics {
    const result: GraphicsDiagnostics = {
        context: "unavailable",
        vendor: null,
        renderer: null,
        unmaskedVendor: null,
        unmaskedRenderer: null,
        error: null,
    };
    let gl: WebGLRenderingContext | null = null;
    try {
        const canvas = document.createElement("canvas");
        gl = canvas.getContext("webgl2");
        if (gl) result.context = "webgl2";
        else {
            gl = canvas.getContext("webgl");
            if (gl) result.context = "webgl";
        }
        if (!gl) return result;
        const context = gl;
        const readString = (parameter: number): string | null => {
            const value: unknown = context.getParameter(parameter);
            return typeof value === "string" ? value : null;
        };
        result.vendor = readString(gl.VENDOR);
        result.renderer = readString(gl.RENDERER);
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        if (info) {
            result.unmaskedVendor = readString(info.UNMASKED_VENDOR_WEBGL);
            result.unmaskedRenderer = readString(info.UNMASKED_RENDERER_WEBGL);
        }
    } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
    } finally {
        // Report collection must not exhaust the contexts used by the maps.
        try {
            gl?.getExtension("WEBGL_lose_context")?.loseContext();
        } catch (err) {
            result.error ??= err instanceof Error ? err.message : String(err);
        }
    }
    return result;
}

const FALLBACK_OUTPUT_FPS = 30;
const MIN_OUTPUT_FPS = 5;
const MAX_OUTPUT_FPS = 120;

/** Share the output rate between capability probes and the encoder. */
export function resolveOutputFps(sourceFps: number | null): number {
    if (sourceFps === null || !Number.isFinite(sourceFps) || sourceFps <= 0) return FALLBACK_OUTPUT_FPS;
    return Math.min(MAX_OUTPUT_FPS, Math.max(MIN_OUTPUT_FPS, sourceFps));
}

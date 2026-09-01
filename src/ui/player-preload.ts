// HTMLMediaElement.readyState values are specified numeric constants. Keeping
// the promotion gate independent from the DOM makes the boundary condition
// cheap to test in Vitest's node environment.
const HAVE_FUTURE_DATA = 3;

/**
 * A preload is safe to promote only once playback can advance beyond its
 * current frame. HAVE_METADATA (1) knows only the duration/tracks, and
 * HAVE_CURRENT_DATA (2) may hold a single frame; either can stall immediately
 * after the slot swap, especially at high playback rates.
 */
export function isPreloadReadyForPromotion(readyState: number): boolean {
    return readyState >= HAVE_FUTURE_DATA;
}

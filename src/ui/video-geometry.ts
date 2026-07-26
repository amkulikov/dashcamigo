// Shared contain-fit geometry: the rect a video frame of a given aspect
// occupies inside a tile under object-fit:contain. The crop editor and the
// digital zoom both reason about this same rect - one implementation so a
// rounding / zero-height fix reaches every consumer instead of one copy.

export type Rect = { x: number; y: number; w: number; h: number };

/** Contain-fit rect of a given aspect (w/h) inside a tw x th box, in box px. */
export function containRect(aspect: number, tw: number, th: number): Rect {
    const tileAspect = tw / Math.max(1, th);
    if (aspect >= tileAspect) {
        const w = tw;
        const h = tw / aspect;
        return { x: 0, y: (th - h) / 2, w, h };
    }
    const h = th;
    const w = th * aspect;
    return { x: (tw - w) / 2, y: 0, w, h };
}

// Shared media-query predicates. One place for the matchMedia strings so the
// reduced-motion and coarse-pointer checks don't drift across modules
// (CLAUDE.md "abstractions against duplicates"). All live and SSR/no-matchMedia
// safe: a MediaQueryList's .matches tracks the environment on its own, so the
// cached list below is as live as re-creating one per call.

/** True when the user asked the OS to reduce non-essential motion (WCAG 2.3.3). */
export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Touch is detected by the pointer being coarse. Exposed as a shared query string
// too so a live MediaQueryList listener (the map's cooperative-gestures toggle)
// re-reads the exact same condition as the predicate.
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

// Cached because isCoarsePointer sits on warm paths (timeline geometry during
// drags); creating a fresh MediaQueryList per call is avoidable garbage.
let coarsePointerList: MediaQueryList | null = null;

/** True on a coarse pointer (touch). */
export function isCoarsePointer(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    coarsePointerList ??= window.matchMedia(COARSE_POINTER_QUERY);
    return coarsePointerList.matches;
}

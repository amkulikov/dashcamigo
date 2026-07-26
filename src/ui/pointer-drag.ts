// Shared pointer-drag scaffolding. Every drag surface in the player (PiP
// move/resize, crop rect/handles, overlay/watermark drags, map resize, column
// divider) needs the same boilerplate: a primary-button pointerdown that
// captures the pointer, a pointerId-filtered move, and a single finish on
// pointerup OR pointercancel. Hand-rolled copies had already drifted apart -
// some missed the primary-button check (right-click started a resize), some
// called setPointerCapture unguarded (throws NotFoundError for an
// already-inactive pointer), one tracked a bare boolean so a second touch
// mid-drag corrupted the gesture. One implementation, one set of fixes.

export interface PointerDragHandlers {
    /**
     * Gesture preconditions + per-drag state capture. Runs on a primary-button
     * pointerdown while no drag is active. Return false to ignore the event
     * (e.g. wrong target, mode not active) - nothing is captured then.
     */
    onStart: (e: PointerEvent) => boolean;
    /** Pointer moved while THIS drag's pointer is down (other pointers are
     *  filtered out, so a second touch cannot corrupt the gesture). */
    onMove: (e: PointerEvent) => void;
    /** Fired exactly once per started drag, on pointerup OR pointercancel. */
    onEnd?: (e: PointerEvent) => void;
}

/**
 * Wires the pointerdown/move/up/cancel quartet on `el` with pointer capture.
 * Handlers receive the raw events; geometry math stays at the call site.
 */
export function attachPointerDrag(el: HTMLElement, handlers: PointerDragHandlers): void {
    let pointerId = -1;
    el.addEventListener("pointerdown", (e) => {
        // Primary button / touch only - right-click must not start a drag.
        if (e.button !== 0) return;
        // One drag at a time: a second touch mid-drag is ignored, not adopted.
        if (pointerId !== -1) return;
        if (!handlers.onStart(e)) return;
        pointerId = e.pointerId;
        try {
            el.setPointerCapture(e.pointerId);
        } catch {
            // Pointer already inactive (released within the same tick) - the
            // up/cancel below still fires, so the drag ends normally.
        }
    });
    el.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pointerId) return;
        handlers.onMove(e);
    });
    const finish = (e: PointerEvent): void => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        handlers.onEnd?.(e);
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
}

/**
 * Suppresses iOS history swipe-back/forward for drags starting on `el` near a
 * screen edge. iOS arms the swipe on touches that START within the edge strip,
 * and the only page-side lever against it is preventDefault on a NON-PASSIVE
 * touchstart - pointer-event preventDefault does not reach that gesture. Only
 * edge-starting touches are cancelled, so taps elsewhere on `el` keep their
 * synthetic click. Android's system back-swipe ignores this entirely - there
 * the layout gutter is the mitigation (chart.ts TIMELINE_EDGE_GUTTER_*).
 */
export function suppressEdgeSwipeNav(el: HTMLElement, edgePx = 36): void {
    el.addEventListener(
        "touchstart",
        (ev) => {
            const x = ev.touches[0]?.clientX;
            if (x === undefined) return;
            if (x < edgePx || x > window.innerWidth - edgePx) ev.preventDefault();
        },
        { passive: false },
    );
}

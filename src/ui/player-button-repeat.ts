interface ButtonRepeatOptions {
    delayMs: number;
    repeatMs: number;
    start: () => ((elapsedMs: number) => undefined | false) | null;
    activate: () => void;
}

/** Pointer holds repeat while the button stays under the pointer. Native keyboard
 *  and assistive activation keep ordinary button click semantics. */
export function initButtonRepeat(button: HTMLButtonElement, options: ButtonRepeatOptions): void {
    let delayTimer: number | null = null;
    let repeatTimer: number | null = null;
    let hold: { pointerId: number; startedAt: number; progress: (elapsedMs: number) => undefined | false } | null =
        null;

    const applyProgress = (): void => {
        if (hold?.progress(performance.now() - hold.startedAt) === false) cancel();
    };
    const cancel = (): void => {
        if (delayTimer !== null) clearTimeout(delayTimer);
        if (repeatTimer !== null) clearInterval(repeatTimer);
        delayTimer = repeatTimer = null;
        hold = null;
    };

    button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        cancel();
        const progress = options.start();
        if (!progress) return;
        hold = { pointerId: event.pointerId, startedAt: performance.now(), progress };
        // Touch captures implicitly; release it so dragging away cancels as on mouse.
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
        delayTimer = window.setTimeout(() => {
            applyProgress();
            if (hold) repeatTimer = window.setInterval(applyProgress, options.repeatMs);
        }, options.delayMs);
    });
    button.addEventListener("pointerup", (event) => {
        if (hold?.pointerId !== event.pointerId) return;
        applyProgress();
        cancel();
    });
    for (const name of ["pointercancel", "pointerleave"] as const) {
        button.addEventListener(name, (event) => {
            if (hold?.pointerId === event.pointerId) cancel();
        });
    }
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancel();
    });
    button.addEventListener("click", (event) => {
        if (event.detail === 0) options.activate();
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
}

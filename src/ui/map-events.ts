interface MapRenderEvents {
    once(type: "idle" | "render", listener: () => void): unknown;
    off(type: "idle" | "render", listener: () => void): unknown;
}

/** Remote tiles may never finish loading; every render wait is bounded. */
export function waitForMapEvent(
    map: MapRenderEvents,
    event: "idle" | "render",
    timeoutMs: number,
    options: { signal?: AbortSignal; start?: () => void } = {},
): Promise<void> {
    const { signal, start } = options;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
        }
        const cleanup = (): void => {
            map.off(event, finish);
            signal?.removeEventListener("abort", onAbort);
            clearTimeout(timeoutId);
        };
        const finish = (): void => {
            cleanup();
            resolve();
        };
        const onAbort = (): void => {
            cleanup();
            reject(new DOMException("aborted", "AbortError"));
        };
        const timeoutId = setTimeout(finish, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        map.once(event, finish);
        try {
            // Camera changes can fire events synchronously, so subscribe first.
            start?.();
        } catch (err) {
            cleanup();
            reject(err);
        }
    });
}

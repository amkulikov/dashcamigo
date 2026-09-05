// A hung image or optional script can postpone window.load indefinitely.
// Bound that wait, and retry failed installs when the connection returns.
import { createLogger } from "../log.js";

const log = createLogger("sw");

export function scheduleServiceWorkerRegistration(register: () => Promise<void>): () => void {
    let isPending = false;
    let isRunning = false;
    let shouldRetry = false;
    let isStopped = false;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
        if (isStopped) return;
        isRunning = true;
        try {
            await register();
        } catch (err) {
            log.warn("registration failed", { error: err instanceof Error ? err.message : String(err) });
        } finally {
            isRunning = false;
            isPending = false;
            if (shouldRetry) {
                shouldRetry = false;
                schedule();
            }
        }
    };
    const schedule = (): void => {
        clearTimeout(loadDeadline);
        window.removeEventListener("load", schedule);
        if (isPending || isStopped) return;
        isPending = true;
        if (typeof requestIdleCallback === "function") {
            idleId = requestIdleCallback(run, { timeout: 3000 });
        } else {
            timer = setTimeout(run, 1000);
        }
    };
    const onOnline = (): void => {
        if (isRunning) shouldRetry = true;
        else schedule();
    };
    const loadDeadline = setTimeout(schedule, 5000);
    window.addEventListener("online", onOnline);
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
        isStopped = true;
        clearTimeout(loadDeadline);
        clearTimeout(timer);
        if (idleId !== undefined) cancelIdleCallback(idleId);
        window.removeEventListener("load", schedule);
        window.removeEventListener("online", onOnline);
    };
}

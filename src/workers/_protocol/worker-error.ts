/** Transport failures can degrade independently of handler invariant violations. */
export function workerUnavailableError(cause: unknown): Error {
    const err = new Error(cause instanceof Error ? cause.message : String(cause), { cause });
    err.name = "WorkerUnavailableError";
    return err;
}

export function isWorkerUnavailableError(err: unknown): boolean {
    return err instanceof Error && err.name === "WorkerUnavailableError";
}

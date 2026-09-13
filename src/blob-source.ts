import { BlobSource } from "mediabunny";

import { createLogger } from "./log.js";
import { clampTsGpsTrailer } from "./ts-trailer.js";

const log = createLogger("media-source");

/** Background prefetch can fail after the requested bytes already reached the caller. */
export function createBackgroundReadErrorHandler(blob: Blob, signal?: AbortSignal): (err: unknown) => void {
    let reported = false;
    return (err) => {
        if (signal?.aborted || reported) return;
        reported = true;
        // Keep cached data usable. A later demand read still rejects normally if the source remains unreadable.
        log.warn("background source read failed", {
            file: blob instanceof File ? blob.name : undefined,
            err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
    };
}

/** The signal suppresses cancelled-operation diagnostics; the caller still owns Input disposal. */
export async function createBlobSource(blob: Blob, signal?: AbortSignal): Promise<BlobSource> {
    return new BlobSource(await clampTsGpsTrailer(blob), {
        handleUnhandledError: createBackgroundReadErrorHandler(blob, signal),
    });
}

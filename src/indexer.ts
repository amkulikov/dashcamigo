// Main-thread facade for recording indexing. The MP4/TS work lives in
// workers/indexer-worker.ts; this module owns its singleton client and routes
// progress for concurrent background and foreground batches.
//
// Keeping the bounded moov walk off the main thread avoids accumulated CPU
// stalls on large cards. The worker also hands moov bytes straight through to
// GPS extraction, avoiding a second cold-storage read.

import { createLogger } from "./log.js";
import {
    INDEXER_NOTIFY_PROGRESS,
    INDEXER_REQUEST_INDEX_ALL,
    type IndexProgressNotificationData,
    type IndexRequestData,
    type IndexedMp4,
    type IndexerRepair,
} from "./workers/indexer-protocol.js";
import { createWorkerClient, type WorkerClient } from "./workers/_protocol/worker-client.js";

const log = createLogger("indexer");

// Public worker result types used by candidate construction and repair.
export type { IndexerRepair } from "./workers/indexer-protocol.js";
export type { Mp4Rotation } from "./parsers/internal/mp4-walker.js";

/**
 * Callback fired once per indexed file. `indexed === null` means the file
 * is unreadable / not an MP4. `moovBytes` is provided when
 * indexAllMp4Files was called with `options.withMoovBytes=true` AND the
 * file is MP4/MOV with a valid moov; undefined otherwise. `repair` is
 * provided when the worker detected a container defect (phantom track /
 * broken hvcC) in the file's moov - the caller splices it back; undefined
 * when the moov is clean.
 */
type IndexProgressCallback = (
    done: number,
    total: number,
    file: File,
    indexed: IndexedMp4 | null,
    moovBytes?: Uint8Array,
    repair?: IndexerRepair,
) => void;

// Per-batch progress dispatch table. The worker emits notifications carrying a
// fileIndex; we route to the caller's File reference by that stable position
// in the original `files` array. (Basename is NOT a usable key - it is not
// unique across folders.) New batches register before sending the request and
// unregister in finally.
interface BatchContext {
    files: File[];
    onProgress: IndexProgressCallback;
}
const activeBatches: Map<string, BatchContext> = new Map();
let nextBatchId = 1;

// Single worker client - indexing happens once per ingest, no pool is
// warranted. The worker runs its own internal concurrency pool over files.
let client: WorkerClient | null = null;

function getClient(): WorkerClient {
    if (client && !client.disposed) return client;
    const worker = new Worker(new URL("./workers/indexer-worker.ts", import.meta.url), {
        type: "module",
        name: "indexer-worker",
    });
    log.info("indexer worker spawned");
    client = createWorkerClient(worker, {
        name: "indexer",
        onCrash: () => {
            client = null;
        },
        onNotification: (msg) => {
            if (msg.type !== INDEXER_NOTIFY_PROGRESS) return;
            const data = msg.data as IndexProgressNotificationData;
            // Route by batchId so concurrent background and foreground reads do
            // not cross-fire onProgress with foreign files.
            const ctx = activeBatches.get(data.batchId);
            if (!ctx) return;
            const file = ctx.files[data.fileIndex];
            if (file) ctx.onProgress(data.done, data.total, file, data.result, data.moovBytes, data.repair);
        },
    });
    return client;
}

/**
 * Spawns the indexer worker ahead of ingest so its chunk is fetched (and the
 * worker ready) before the user drops a folder. Called at idle from app.ts.
 * The real index() call reuses this same client.
 */
export function prewarmIndexer(): void {
    getClient();
}

/**
 * Parallel indexing of a file array. Runs in a Web Worker; onProgress fires
 * on the main thread once per file. signal aborts the worker (next iteration
 * boundary granularity).
 *
 * If options.withMoovBytes is true, the worker also returns the raw moov
 * bytes per MP4 file in the corresponding progress callback. ingest.ts uses
 * this to cache moov bytes for files with embedded GPS source-hint and ship
 * them into the gps-extract request - eliminates the duplicate moov read
 * that the gps-extract worker would otherwise do.
 *
 * Results are delivered exclusively through onProgress (once per file); there
 * is no aggregate return value.
 */
export async function indexAllMp4Files(
    files: File[],
    onProgress: IndexProgressCallback,
    concurrency = 4,
    signal?: AbortSignal,
    options?: { withMoovBytes?: boolean },
): Promise<void> {
    if (files.length === 0) return;
    const batchId = String(nextBatchId++);

    // Isolate a throwing onProgress so one bad callback does not abort the
    // whole batch (the worker keeps streaming notifications regardless).
    const wrappedProgress: IndexProgressCallback = (done, total, file, indexed, moovBytes, repair) => {
        try {
            onProgress(done, total, file, indexed, moovBytes, repair);
        } catch (err) {
            log.warn("onProgress callback threw", err);
        }
    };
    activeBatches.set(batchId, { files, onProgress: wrappedProgress });

    try {
        const req: IndexRequestData = {
            batchId,
            files,
            withMoovBytes: options?.withMoovBytes ?? false,
            concurrency,
        };
        await getClient().request(INDEXER_REQUEST_INDEX_ALL, req, { signal });
    } finally {
        activeBatches.delete(batchId);
    }
}

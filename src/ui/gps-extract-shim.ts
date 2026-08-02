// Main-thread shim over a pool of gps-extract workers. Preserves the
// dispatchParseVideoEmbeddedGps() signature so callers (ingest.ts,
// lazy-embedded-gps.ts) need only swap the import.
//
// Pool size: min(navigator.hardwareConcurrency - 1, 4), minimum 1. Reserves
// one core for the main thread and other workers (per-file MSE, transcode,
// frame-extract). On a 4-core Pixel 6a this gives 3 GPS workers. Higher
// counts trash mobile SD IO without further CPU speedup.
//
// Sharding strategy: input classified[] is grouped by cloneAcrossGroup
// affinity (Juscar pairs F/R/I share GPS, the dispatcher parses one and
// clones), then groups are distributed across workers via shardKey.
// This keeps clone-savings intact while giving each worker ~equal work.

import { extendArray } from "../array-extend.js";
import { createLogger } from "../log.js";
// clone-groups, NOT primitives/index: the full primitive registry pulls every
// extractor implementation into this eager module; the shard planner only
// needs the filename groupers (see clone-groups.ts).
import { VIDEO_CLONE_GROUPERS } from "../parsers/primitives/clone-groups.js";
import type { ClassifiedFile, DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import type { AccelSample, GpsRecord, SkippedLine, VendorFile } from "../parsers/types.js";

import {
    GPS_NOTIFY_PROGRESS,
    GPS_REQUEST_EXTRACT,
    type EmbeddedGpsExtractionMode,
    type ExtractRequestData,
    type ExtractResult,
    type ProgressNotificationData,
} from "../workers/gps-extract-protocol.js";
import { createWorkerClient } from "../workers/_protocol/worker-client.js";
import { createWorkerPool } from "../workers/_protocol/worker-pool.js";

const log = createLogger("gps-extract-shim");

type EmbeddedGpsProgressCallback = (done: number, total: number, file: VendorFile) => void;

function poolCapacity(): number {
    // Reserve one core for the main thread and other workers (mse, transcode,
    // frame-extract). hardwareConcurrency reports logical cores, including
    // SMT/HT - on a phone Safari reports 4-8 on quad/octa-core, on desktop
    // 8-16. Capping at 4 prevents IO trashing on shared SD/UFS.
    const hc = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
    return Math.max(1, Math.min(hc - 1, 4));
}

// Per-batch callback registered before sending request; cleared right after.
// Only one batch in flight per slot, but multiple slots in parallel - so we
// keyed by an opaque token, not by slot idx.
const progressByToken: Map<string, (data: ProgressNotificationData) => void> = new Map();
let activeToken = 0;

const pool = createWorkerPool({
    name: "gps-extract",
    capacity: poolCapacity(),
    factory: (idx, opts) => {
        // The worker `name` option must be a static literal so vite's
        // worker-import-meta-url plugin can resolve it at build time. The
        // per-slot idx lives in our log context.
        const worker = new Worker(new URL("../workers/gps-extract-worker.ts", import.meta.url), {
            type: "module",
            name: "gps-extract-worker",
        });
        log.info("gps-extract worker slot spawned", { idx });
        return createWorkerClient(worker, {
            name: `gps-extract-${idx}`,
            onCrash: opts.onCrash,
            onNotification: (msg) => {
                if (msg.type !== GPS_NOTIFY_PROGRESS) return;
                // Route to the originating dispatch by its token. Without this,
                // a notification from one of several concurrently-registered
                // batches would increment every batch's counter (overcounting
                // the "Embedded GPS done/total" label past total).
                const data = msg.data as ProgressNotificationData;
                const cb = progressByToken.get(data.token);
                if (cb) cb(data);
            },
        });
    },
});

/**
 * Spawns one gps-extract worker ahead of ingest so its chunk is warm (and the
 * worker ready) by the time the user drops a folder. Called at idle from
 * app.ts; the real extraction reuses the warm slot.
 */
export function prewarmGpsExtract(): void {
    pool.prewarm();
}

/**
 * Splits video files in `classified` into `n` chunks preserving
 * cloneAcrossGroup affinity (Juscar F/R/I + similar). Non-video files are
 * dropped (the worker filters them anyway).
 */
function shardByCloneAffinity(classified: ClassifiedFile[], n: number): ClassifiedFile[][] {
    const videos = classified.filter((c) => c.role === "video");
    if (videos.length === 0 || n <= 1) return videos.length > 0 ? [videos] : [];

    const groups = new Map<string, ClassifiedFile[]>();
    const singletons: ClassifiedFile[] = [];
    for (const v of videos) {
        let key: string | null = null;
        for (const ex of VIDEO_CLONE_GROUPERS) {
            const k = ex.cloneAcrossGroup(v.file);
            if (k !== null) {
                key = `${ex.id}:${k}`;
                break;
            }
        }
        if (key === null) {
            singletons.push(v);
        } else {
            let arr = groups.get(key);
            if (!arr) {
                arr = [];
                groups.set(key, arr);
            }
            arr.push(v);
        }
    }

    const chunks: ClassifiedFile[][] = Array.from({ length: n }, () => []);
    let cursor = 0;
    for (const arr of groups.values()) {
        chunks[cursor % n]!.push(...arr);
        cursor++;
    }
    for (const s of singletons) {
        chunks[cursor % n]!.push(s);
        cursor++;
    }
    return chunks.filter((c) => c.length > 0);
}

/** Same signature as dispatchParseVideoEmbeddedGps in parsers/registry.js,
 *  plus optional prebuiltMoovByPath to skip the 2× moov read on cold SD. */
export function dispatchParseVideoEmbeddedGpsViaWorker(
    classified: ClassifiedFile[],
    onProgress?: EmbeddedGpsProgressCallback,
    // Signature parity with the registry dispatcher (see file header: callers
    // swap implementations by swapping the import alone). In THIS worker-pool
    // variant the value is unused - pool size dictates parallelism; the
    // registry's in-thread variant does consume it.
    _concurrency = 4,
    signal?: AbortSignal,
    mode: EmbeddedGpsExtractionMode = "all",
    // Keyed by relativePath (vendorFileKey), not basename - see protocol note.
    prebuiltMoovByPath?: Map<string, Uint8Array>,
): Promise<DispatchedEmbeddedGpsResult> {
    const cap = poolCapacity();
    const videoCount = classified.filter((c) => c.role === "video").length;
    const effectiveShards = Math.min(cap, Math.max(1, videoCount));
    const chunks = shardByCloneAffinity(classified, effectiveShards);
    if (chunks.length === 0) {
        return Promise.resolve({
            appliedExtractors: [],
            records: [],
            skipped: [],
            errors: [],
            winningExtractorByFilename: new Map(),
            videoStartUtcHintByFilename: new Map(),
            localClockOffsetHintByFilename: new Map(),
            accelByFilename: new Map(),
            heavyFiles: [],
        });
    }

    const total = chunks.reduce((s, c) => s + c.length, 0);
    let doneFiles = 0;
    // Keyed by basename (NOT relativePath, unlike prebuiltMoovByPath): the worker's
    // ProgressNotificationData.fileName is file.file.name, so the lookup must match
    // that. Only feeds the progress label's "current file" - a same-basename
    // collision here is cosmetic (which name to show), never GPS mis-attribution.
    const fileByName = new Map<string, VendorFile>();
    for (const c of classified) fileByName.set(c.file.file.name, c.file);

    // One token per dispatch call - lets multiple parallel ingests (rare but
    // possible: bulk ingest + lazy-extra-extract on trip click) keep their
    // progress streams separate.
    const token = String(activeToken++);
    if (onProgress) {
        progressByToken.set(token, (data) => {
            doneFiles++;
            const vf = fileByName.get(data.fileName);
            if (vf) onProgress(doneFiles, total, vf);
        });
    }

    const subResults = chunks.map((chunk, shardIdx) => {
        // Build a per-shard sub-map of prebuilt moov bytes - only the files
        // that are actually in THIS shard, keyed by relativePath. Each
        // Uint8Array is transferred (zero-copy) to its worker; we list every
        // buffer in `transfer`. Keying by relativePath (not basename) is what
        // keeps a buffer from being listed in two shards' transfer arrays.
        let shardMoov: Map<string, Uint8Array> | undefined;
        const transfer: Transferable[] = [];
        if (prebuiltMoovByPath && prebuiltMoovByPath.size > 0) {
            shardMoov = new Map();
            for (const cf of chunk) {
                const key = cf.file.relativePath || cf.file.file.name;
                const bytes = prebuiltMoovByPath.get(key);
                if (bytes) {
                    shardMoov.set(key, bytes);
                    transfer.push(bytes.buffer);
                }
            }
            if (shardMoov.size === 0) shardMoov = undefined;
        }

        const req: ExtractRequestData = {
            // All shards of one dispatch carry the SAME token so their progress
            // notifications route to this dispatch's single callback.
            token,
            classified: chunk,
            // concurrency=1 inside the worker: file-level parallelism comes
            // from the pool, internal concurrency would just trash IO further.
            concurrency: 1,
            mode,
            prebuiltMoovByPath: shardMoov,
        };
        // shardKey pins same-affinity chunks to the same slot if dispatched
        // back-to-back during the same session - but more importantly,
        // distributes our N chunks across N distinct slots.
        return pool.request<ExtractResult>(GPS_REQUEST_EXTRACT, req, {
            signal,
            shardKey: `shard-${shardIdx}`,
            transfer,
        });
    });

    return Promise.allSettled(subResults)
        .then((settled) => {
            // Crash isolation: one worker slot dying must not discard the healthy
            // shards of this (or any concurrently in-flight) batch. Merge the
            // survivors; fold each crashed shard into the standard parse-error
            // channel so ingest.ts surfaces it without aborting the whole drop.
            const fulfilled: DispatchedEmbeddedGpsResult[] = [];
            const shardErrors: DispatchedEmbeddedGpsResult["errors"] = [];
            for (let i = 0; i < settled.length; i++) {
                const s = settled[i]!;
                if (s.status === "fulfilled") {
                    fulfilled.push(s.value);
                    continue;
                }
                // User cancel must still propagate so ingest.ts aborts the stage
                // rather than treating it as a per-file failure (ingest.ts:817).
                if (s.reason instanceof DOMException && s.reason.name === "AbortError") {
                    throw s.reason;
                }
                // One error PER FILE of the dead shard, named by basename -
                // never one "shard-N" entry. Consumers key this channel by
                // file.name to decide what may be written to the index cache;
                // a synthetic shard name matches nothing, so every file the
                // crash swallowed would be cached as a confirmed "no GPS" and
                // never re-extracted. The whole shard did fail, so naming each
                // of its files is also the honest report.
                const message = s.reason instanceof Error ? s.reason.message : String(s.reason);
                for (const cf of chunks[i] ?? []) {
                    shardErrors.push({ file: cf.file.file.name, extractor: "gps-extract-worker", message });
                }
            }
            const merged = mergeResults(fulfilled);
            extendArray(merged.errors, shardErrors);
            return merged;
        })
        .finally(() => {
            if (onProgress) progressByToken.delete(token);
        });
}

/**
 * Concatenates several DispatchedEmbeddedGpsResult into one. Exposed so the
 * streaming-batch caller (ingest.ts: per-batch flush) can merge results from
 * multiple sequential dispatches into a single shape compatible with the
 * downstream `applyEmbeddedResultToState` call.
 */
export function mergeEmbeddedResults(results: DispatchedEmbeddedGpsResult[]): DispatchedEmbeddedGpsResult {
    return mergeResults(results);
}

function mergeResults(results: DispatchedEmbeddedGpsResult[]): DispatchedEmbeddedGpsResult {
    const appliedSet = new Set<string>();
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    const errors: DispatchedEmbeddedGpsResult["errors"] = [];
    const winningExtractorByFilename = new Map<string, string>();
    const videoStartUtcHintByFilename = new Map<string, number>();
    const localClockOffsetHintByFilename = new Map<string, number>();
    const accelByFilename = new Map<string, AccelSample[]>();
    const heavyFiles: ClassifiedFile[] = [];
    for (const r of results) {
        for (const ex of r.appliedExtractors) appliedSet.add(ex);
        // extendArray, not push(...): a long single-file embedded GPS stream
        // (Novatek/GoPro) can carry 100k+ records and the spread overflows the
        // call-argument limit.
        extendArray(records, r.records);
        extendArray(skipped, r.skipped);
        extendArray(errors, r.errors);
        for (const [k, v] of r.winningExtractorByFilename) winningExtractorByFilename.set(k, v);
        for (const [k, v] of r.videoStartUtcHintByFilename) videoStartUtcHintByFilename.set(k, v);
        for (const [k, v] of r.localClockOffsetHintByFilename) localClockOffsetHintByFilename.set(k, v);
        for (const [k, v] of r.accelByFilename) accelByFilename.set(k, v);
        extendArray(heavyFiles, r.heavyFiles);
    }
    return {
        appliedExtractors: [...appliedSet],
        records,
        skipped,
        errors,
        winningExtractorByFilename,
        videoStartUtcHintByFilename,
        localClockOffsetHintByFilename,
        accelByFilename,
        heavyFiles,
    };
}

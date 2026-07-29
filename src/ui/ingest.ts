// Main processing pipeline for an SD card folder or drag-and-drop drop:
// classify → parse logs/sidecars → indexAllMp4Files → embedded GPS →
// canPlay check → recomputeAllStartUtc → groupTrips → renderTrips.
//
// Supports cancellation via AbortController (state.ingestController).
// On a second drop during an active ingest, the set is queued in state.ingestQueue
// and started after the current ingest's finally{}.

import { t } from "../i18n/index.js";
import { dropDuplicateFiles } from "../ingest-dedup.js";
import { ignoredRootSegments, isIgnoredPath } from "../ingest-filter.js";
import { indexAllMp4Files } from "../indexer.js";
import { createLogger } from "../log.js";
import { captureSentryException, captureSentryMessage } from "../sentry.js";
import { emitLifecycle, markStage } from "../perf.js";
import { cloneRecordsAcrossChannels, firstSyncedRecord, mergeIntoGpsLog, rebindOrphanLogRecords } from "../parser.js";
import { combineAccelSources, mergeAccelSamples } from "../parsers/registry-light.js";
import type { DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import {
    classifyFilesViaPool as dispatchClassifyFiles,
    dispatchParseAccelSidecarsViaPool as dispatchParseAccelSidecars,
    dispatchParseLogsViaPool as dispatchParseLogs,
    dispatchParseSidecarsViaPool as dispatchParseSidecars,
} from "./ingest-shim.js";
import type { VendorFile } from "../parsers/types.js";
import { cameraFingerprint } from "../parsers/camera-fingerprint.js";
import { classifyFilenameTime } from "../parsers/filename/index.js";
import { classifyGpsSource, shouldTryEmbeddedGps } from "../parsers/gps-source-hints.js";
import { planEmbeddedGpsQueue } from "./embedded-gps-queue.js";
import {
    dispatchParseVideoEmbeddedGpsViaWorker as dispatchParseVideoEmbeddedGps,
    mergeEmbeddedResults,
} from "./gps-extract-shim.js";
import {
    deriveStartUtc,
    deriveWallDurationSec,
    estimatePreciseClockOffsetByFingerprint,
    estimateTzByFingerprint,
    rederiveStartUtcForCandidates,
    resolvePreciseClockOffsetForFile,
    tripAllCandidates,
} from "../trips.js";
import type { TzSample, VideoCandidate } from "../trips.js";
import { isMatroskaName, isTransportStreamName } from "../video-format-names.js";

import { maybeRunIngestTour } from "./onboarding.js";
import { maybeShowPostIngestToast } from "./pwa-install.js";
import {
    hideIngestOverlay,
    hideIngestProgress,
    setIngestCancelLabel,
    setIngestProgress,
    setIngestStage,
    showIngestOverlay,
    syncIngestQueueIndicator,
} from "./ingest-overlay.js";
import { renderTrips, updateTripPreview } from "./sidebar.js";
import { state } from "./state.js";
import { notify } from "./notifications.js";
import { schedulePopulateTripPreviews } from "./trip-preview.js";
import { looksLikeRecordings } from "../report-structure.js";
import { showNoRecordingsModal } from "./no-recordings-modal.js";
import { countUnplayableByExtension, showUnsupportedFormatsModal } from "./unsupported-formats-modal.js";
import { applyIndexRepair, checkCanPlay, filenameClassifierFields, vendorFileKey } from "./ingest-candidate.js";
import {
    cancelLazyHydration,
    pickIngestScheduler,
    registerRecomputeSweep,
    resumeLazyHydrationIfPending,
    runLazyHydration,
} from "./lazy-hydrate.js";
import { applyRegroup } from "./apply-regroup.js";
import { refreshTrip } from "./lazy-embedded-gps.js";
import { countByExtension, countByField, embeddedResultHasEffect, raceWithAbort } from "./ingest-core.js";

const log = createLogger("ingest");

/**
 * Awaits the given promise, but rejects with AbortError as soon as the signal
 * aborts. The promise's underlying work keeps running - this only releases the
 * awaiter so the ingest finally{} can hide the overlay without waiting on
 * background tasks (preview generation) that have their own signal.
 */
/**
 * Resolves after the browser has painted at least once. Double requestAnimationFrame:
 * the first callback fires before a paint, the second after it. Lets a just-shown
 * blocking overlay render before the main thread starts a long synchronous pass.
 * The setTimeout cap keeps a backgrounded tab (rAF suspended) from hanging ingest.
 */
function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        requestAnimationFrame(() => requestAnimationFrame(done));
        setTimeout(done, 100);
    });
}

/**
 * Public entry point: shows the blocking overlay, manages the AbortController and the drop queue,
 * and (after finally) starts the next queued item.
 *
 * If an ingest is already running, the files go into state.ingestQueue and are started sequentially
 * after the current ingest finishes (success / cancel / error). No drop is ever lost.
 */
export async function ingestFiles(vfiles: VendorFile[]): Promise<void> {
    // Empty drop (a DnD that yielded nothing) - not a real ingest; warn and bail
    // without opening the overlay. The hidden/junk-path filter, which may also
    // empty the list, runs later (ingestFilesInternal, after the overlay paints)
    // so this entry point stays O(1) and the modal appears immediately on a large
    // mobile card instead of after a multi-pass main-thread stall.
    if (vfiles.length === 0) {
        notify({ severity: "warn", messageKey: "status.filesNotSelected" });
        return;
    }

    if (state.ingestInProgress) {
        // Queue the raw (unfiltered) list - it is filtered when this wrapper
        // re-runs on it at dequeue, so no junk slips through.
        state.ingestQueue.push(vfiles);
        syncIngestQueueIndicator();
        return;
    }

    state.ingestInProgress = true;
    state.ingestController = new AbortController();
    showIngestOverlay();
    setIngestStage(t("ingestOverlay.stage.classifying"));
    setIngestProgress({ mode: "indeterminate" });
    syncIngestQueueIndicator();

    let cancelled = false;
    let failed = false;
    try {
        await ingestFilesInternal(vfiles, state.ingestController.signal);
    } catch (err) {
        // AbortError means the user clicked Cancel; partial state stays in the sidebar.
        if (err instanceof DOMException && err.name === "AbortError") {
            // Log so we can distinguish "it hung" vs "user cancelled" in bug reports.
            log.info("ingest cancelled");
            cancelled = true;
        } else {
            failed = true;
            log.error("ingest failed", err);
            // Raw cause is logged above; the user gets clear, actionable guidance
            // instead of a leaked browser exception string.
            notify({ severity: "error", messageKey: "ingest.error.loadFailed" });
            const reason = err instanceof Error ? err.name || "Error" : "unknown";
            // Most severe user-facing ingest outcome: the app loaded nothing.
            // Capture the real exception (stack), fingerprint by error name (the
            // message can embed a filename/path from a deeper throw).
            captureSentryException(err, { fingerprint: ["ingest_failed", reason], tags: { reason } });
        }
    } finally {
        state.ingestController = null;
        state.ingestInProgress = false;
        hideIngestOverlay();
        // UX-02: on success/error - smoothly advance to 100%; on cancel - instantly hide so the user does not think progress is still running.
        hideIngestProgress(/*activeFinish=*/ !cancelled);
        // Cancel/error paths: ingestFilesInternal tore down any prior lazy fill
        // at entry (cancelLazyHydration) and then threw before reaching the
        // eager tail's resume, so the previous drop's trips would stay
        // provisional forever. Restart the fill for anything still pending.
        // NOT on success: those paths already own their fill lifecycle, and a
        // double-resume there would reset the analytics elapsed baseline (A2).
        if (cancelled || failed) resumeLazyHydrationIfPending();
    }

    // Start the next queued item after the current ingest fully finishes (ingestInProgress = false above,
    // otherwise the wrapper would push it back into the queue). Tail call - stack does not grow.
    const next = state.ingestQueue.shift();
    if (next) {
        // No await - to not keep the first ingest session's promise chain alive.
        // void + .catch prevents the unhandled rejection from the next ingest from polluting the global uncaught handler.
        // ingestFiles already logs errors internally, so this catch is just a suppressor.
        void ingestFiles(next).catch(() => {
            /* already logged inside ingestFiles */
        });
    }
}

async function ingestFilesInternal(vfiles: VendorFile[], signal: AbortSignal): Promise<void> {
    // Stop any background hydration still running from a previous drop before this
    // one rebuilds state.trips - a stale fill would write onto the wrong trips.
    cancelLazyHydration();
    // Drop the previous drop's deferred heavy-embedded-GPS entries. The map is
    // basename-keyed, so a leftover entry from an un-opened trip would (a)
    // permanently paint a new drop's same-basename card as "pending" and (b) on
    // click parse the OLD file's bytes and hang its GPS on the new video (G4).
    // The eager path re-populates it from this drop's own heavy files below.
    state.pendingHeavyEmbeddedGps.clear();
    // Let the just-shown overlay paint before any O(n) main-thread pass. On a
    // clean all-video drop nothing below hits a real async barrier until MP4
    // indexing, so the path filter + dedup fingerprinting + classify + the
    // "ingest started" log (each walks every file, the last two with per-file
    // regex) would otherwise all run before the modal ever appears - hundreds of
    // ms on a large mobile card. One forced frame here moves the whole stall
    // behind the visible "Classifying..." overlay.
    await nextPaint();

    // Snapshot the raw drop (path/size/mtime via File refs, no content read) for
    // the "help add my camera" report. Kept even when this ingest yields zero
    // trips - the case that otherwise discards the tree. Taken before the
    // hidden/junk filter on purpose: proxy dirs (.s_Front, DCIM quirks) are
    // useful onboarding signal. Overwritten each drop, not accumulated.
    state.lastIngestFiles = [...vfiles];

    // Drop hidden/junk-dir files (70mai .s_* proxies, macOS/Windows system dirs)
    // before anything touches them. Single chokepoint for both the picker and DnD
    // paths, so junk never costs an SD seek and never collides on basename with a
    // real recording. One summary log so a "my files did not load" report can be
    // traced to a path we skipped.
    const totalDropped = vfiles.length;
    const kept = vfiles.filter((vf) => !isIgnoredPath(vf.relativePath));
    if (kept.length < totalDropped) {
        log.debug("ignored hidden/system paths", { ignored: totalDropped - kept.length, total: totalDropped });
    }
    if (kept.length === 0) {
        // The filter emptied a non-empty selection: every file sat in a hidden
        // or system folder. This is NOT the empty-drop case (that returns in the
        // ingestFiles wrapper) - the user picked real files, they just all live
        // under a folder we skip. Give a dedicated hint ("pick the folder with
        // your recordings") instead of the generic filesNotSelected toast, and
        // log the distinct junk roots (the folder the user chose) so a "my files
        // did not load" report can be traced to the exact name we rejected.
        log.info("selection was entirely hidden/system files", {
            total: totalDropped,
            junkRoots: ignoredRootSegments(vfiles.map((vf) => vf.relativePath)),
        });
        notify({ severity: "warn", messageKey: "status.onlyHiddenFiles" });
        // cancelLazyHydration at entry tore down any prior lazy fill; this path
        // never reaches runLazyHydration, so restart it or the previous drop's
        // trips stay provisional forever (A2).
        resumeLazyHydrationIfPending();
        return;
    }
    vfiles = kept;

    // Reset the bad-MP4 counter - it is per-ingest. Without resetting, repeated drops would keep growing
    // "N files could not be indexed" even on perfectly valid batches (see formatIngestStatus).
    state.unindexed = [];

    // Per-ingest stage timings for the final "ingest done" log. Each heavy stage is wrapped via mark().
    // Rounded to 1 ms - sub-millisecond precision is noise here. Same mark() also calls markStage()
    // so each stage produces a performance.measure entry visible in DevTools and read by the perf-test harness.
    const ingestStart = performance.now();
    // Baseline for the end-of-ingest "gps records skipped" summary: gpsLog
    // persists across ingests and mergeIntoGpsLog concatenates skipped[], so
    // without the snapshot the 2nd+ drop re-reports prior ingests' rows.
    const skippedLinesBaseline = state.gpsLog?.skipped.length ?? 0;
    const stageMs: Record<string, number> = {};
    const mark = <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
        const t0 = performance.now();
        return markStage(`ingest:${stage}`, fn).finally(() => {
            stageMs[stage] = Math.round(performance.now() - t0);
        });
    };

    // Files already loaded into trips - the comparison base both for duplicate
    // exclusion below and for sidecar classification (existingVideoNames).
    const alreadyLoaded: VendorFile[] = [];
    for (const trip of state.trips) {
        for (const c of tripAllCandidates(trip)) {
            alreadyLoaded.push({ file: c.file, relativePath: c.relativePath });
        }
    }

    // Drop byte-identical copies (same basename+size, confirmed by a head/tail
    // content probe) before classify/indexing, so a duplicated subfolder in the
    // drop - or a re-dropped Backup copy of an already-loaded card - does not
    // double trip footage and never costs an SD seek. See src/ingest-dedup.ts.
    const dedup = await mark("dedup", () => dropDuplicateFiles(vfiles, alreadyLoaded, signal));
    if (dedup.dropped.length > 0) {
        // Toast so the user knows why the loaded count is below the drop count;
        // sample pairs in the log so a "my files did not load" report can be
        // traced to the surviving path.
        log.info("skipped duplicate files", {
            skipped: dedup.dropped.length,
            total: vfiles.length,
            sample: dedup.dropped.slice(0, 5),
        });
        notify({
            severity: "info",
            messageKey: "status.duplicatesSkipped",
            messageParams: { n: dedup.dropped.length },
        });
        vfiles = dedup.kept;
    }

    // Sidecar classification looks at already-known videos (state.trips + newly classified) so the user can drop a GPX later for a previously loaded MP4.
    const existingVideoNames = new Set<string>(alreadyLoaded.map((vf) => vf.file.name));
    const classified = await mark("classify", () => dispatchClassifyFiles(vfiles, existingVideoNames, signal));

    // Extract video candidates with their role/relativePath - used from here on instead of the raw File[].
    const videos = classified.filter((c) => c.role === "video");
    const totalGpsLogs = classified.filter((c) => c.role === "gps-log").length;

    // If the drop contains unplayable containers (.avi/.mts/.wmv/.flv/.3gp/.jdr/.mdt/.insv/.360/...),
    // show the user a modal over the ingest overlay. Non-blocking: void = fire-and-forget,
    // classification and indexing continue while the user reads. Extension list lives in UNPLAYABLE_VIDEO_EXTENSIONS.
    const unplayableByExt = countUnplayableByExtension(vfiles.map((vf) => vf.file.name));
    if (unplayableByExt.size > 0) {
        log.info("unsupported formats in drop", { byExt: Object.fromEntries(unplayableByExt) });
        void showUnsupportedFormatsModal(unplayableByExt);
    }

    // Startup log. Placed after classify so the role/vendor breakdown is already known. Before this point we only have the raw vfiles[] which is less useful for bug reports.
    log.info("ingest started", {
        totalFiles: vfiles.length,
        totalBytes: vfiles.reduce((s, vf) => s + vf.file.size, 0),
        byExtension: countByExtension(vfiles),
        byClassify: {
            video: videos.length,
            gpsLog: totalGpsLogs,
            sidecar: classified.filter((c) => c.role === "sidecar").length,
            unknown: classified.filter((c) => c.role === "unknown").length,
        },
        byFingerprint: countByField(videos, (c) => cameraFingerprint(c.file)),
        // First 5 relative paths to reveal the SD card layout (Normal/Front/..., DCIM/, flat root, etc.).
        // 5 is a compromise: more bloats the entry; fewer may not show the pattern.
        relativePathsSample: vfiles.slice(0, 5).map((vf) => vf.relativePath),
    });

    if (signal.aborted) throw new DOMException("ingest aborted", "AbortError");
    setIngestStage(t("ingestOverlay.stage.parsingLogs"));

    // Parse logs before indexing so byFilename indices are ready when records are attached to files.
    const logsResult = await mark("parseLogs", () => dispatchParseLogs(classified, signal));
    if (logsResult.records.length > 0) {
        // Merge if a log already exists (new file may be a rotated version of the old one, or the same file dropped twice).
        // Dedup by (unixSeconds, lat, lon, mp4Filename) is required: re-dropping the same log doubles brake events, distance, and point density.
        state.gpsLog = mergeIntoGpsLog(state.gpsLog, logsResult);
        // Firmware writes ghost names into the log for locked clips (renamed
        // across mode prefixes, or with garbage after ".MP4") - re-key those
        // records onto the loaded video sharing the same name core, then
        // rebuild the byFilename buckets. Runs here, before any candidate
        // pulls its records, so every downstream exact-name lookup just works.
        const videoNames = new Set<string>(existingVideoNames);
        for (const c of videos) videoNames.add(c.file.file.name);
        const rebound = rebindOrphanLogRecords(state.gpsLog, videoNames);
        if (rebound > 0) {
            state.gpsLog = mergeIntoGpsLog(null, {
                records: state.gpsLog.records,
                appliedExtractors: state.gpsLog.appliedExtractors,
                skipped: state.gpsLog.skipped,
            });
            log.info("rebound orphan gps-log records", { count: rebound });
        }
    }
    if (logsResult.errors.length > 0) {
        log.warn("gps log parse errors", { count: logsResult.errors.length, errors: logsResult.errors });
    }
    reportParseErrorsToSentry("log", logsResult.errors);

    if (signal.aborted) throw new DOMException("ingest aborted", "AbortError");
    setIngestStage(t("ingestOverlay.stage.parsingSidecars"));

    // GPX sidecars: dispatched through the registry. Attachment by basename was done at classify (sidecarMp4 in ClassifiedFile). Same dedup reason as logsResult.
    const sidecarResult = await mark("parseSidecars", () => dispatchParseSidecars(classified, signal));
    if (sidecarResult.records.length > 0) {
        // Sidecars (GPX, .map, .gps) carry only records - no extractor labels or
        // skipped-line diagnostics - so the other two batch fields are empty.
        state.gpsLog = mergeIntoGpsLog(state.gpsLog, {
            records: sidecarResult.records,
            appliedExtractors: [],
            skipped: [],
        });
    }
    if (sidecarResult.errors.length > 0) {
        log.warn("sidecar parse errors", { count: sidecarResult.errors.length, errors: sidecarResult.errors });
    }
    reportParseErrorsToSentry("sidecar", sidecarResult.errors);

    // A shared sidecar (BlackVue `.gps`) classifies against one channel only;
    // clone its records onto the recording's other channels so every channel
    // measures the same clock offset and derives the same startUtc, keeping
    // front+rear in one frame (see cloneRecordsAcrossChannels). Runs on the
    // merged log with the cumulative video set, so a channel dropped in a later
    // ingest still picks up its sibling's track.
    if (state.gpsLog) {
        const allVideoNames = new Set<string>(existingVideoNames);
        for (const c of videos) allVideoNames.add(c.file.file.name);
        const clonedAcrossChannels = cloneRecordsAcrossChannels(state.gpsLog, allVideoNames);
        if (clonedAcrossChannels > 0) {
            state.gpsLog = mergeIntoGpsLog(null, {
                records: state.gpsLog.records,
                appliedExtractors: state.gpsLog.appliedExtractors,
                skipped: state.gpsLog.skipped,
            });
            log.info("cloned sidecar gps across channels", { count: clonedAcrossChannels });
        }
    }

    // Accel-only sidecars (BlackVue .3gf): accelerometer only, no GPS. Merged into GpsRecord via mergeAccelSamples after indexAllMp4Files.
    const accelSidecarResult = await mark("parseAccelSidecars", () => dispatchParseAccelSidecars(classified, signal));
    if (accelSidecarResult.errors.length > 0) {
        log.warn("accel-sidecar parse errors", {
            count: accelSidecarResult.errors.length,
            errors: accelSidecarResult.errors,
        });
    }
    reportParseErrorsToSentry("accel", accelSidecarResult.errors);

    // Skip already-added videos (repeated drop). Key = full relativePath (see vendorFileKey): the same basename from a different SD subdirectory is a separate file.
    const newVideos = videos.filter((c) => !state.addedKeys.has(vendorFileKey(c.file)));
    if (newVideos.length === 0 && state.trips.length > 0) {
        // Only the log changed - re-render existing trips so GPS attachment is updated.
        rebuildTripsFromCurrentFiles();
        renderTrips();
        // This path bypasses runLazyHydration, so a previous lazy drop's fill
        // (torn down at entry) must be restarted or its still-provisional trips
        // never hydrate (A2).
        resumeLazyHydrationIfPending();
        // Nothing exceptional to report - no status line here; an empty
        // "0 broken, 0 repaired" line would just be noise.
        return;
    }

    // Assemble the raw files into the candidate list.
    const allCandidates: VideoCandidate[] = [];

    // Start with existing candidates (from state.trips) - carry them over as-is.
    for (const trip of state.trips) {
        for (const f of tripAllCandidates(trip)) {
            allCandidates.push(f);
        }
    }

    // Estimate camera TZ before indexing - needed for files without GPS where the filename is the only time source.
    // Collect (name, first GPS record) pairs from ALL files (old + new) with a log.
    // Computed before MP4 indexing because it only depends on the already-parsed GPS log and filenames.
    const tzSamples: TzSample[] = [];
    if (state.gpsLog) {
        // Dedup by File identity, not basename: two distinct files that share a
        // basename in different folders (a read-only backup copy + its Movie/
        // sibling) must each contribute a TZ sample - a basename key would drop
        // one. The byFilename lookup below stays basename (parser contract).
        const seen = new Set<File>();
        for (const cf of newVideos) {
            const recs = state.gpsLog.byFilename.get(cf.file.file.name);
            // firstSyncedRecord, not recs[0]: a cold-start (timeUnsynced) first
            // record carries a ~1970 placeholder that would poison the TZ delta.
            const firstSynced = firstSyncedRecord(recs);
            if (firstSynced && !seen.has(cf.file.file)) {
                // mvhd not yet read (this is before indexing). Final TZ re-estimation with mvhd pairs happens in recomputeAllStartUtc after indexAllMp4Files.
                // durationSec unknown for the same reason - run chaining uses the
                // fallback gap until the post-index sweep re-estimates.
                tzSamples.push({
                    file: cf.file,
                    fingerprint: cameraFingerprint(cf.file),
                    firstGpsUnix: firstSynced.unixSeconds,
                    mvhdNaiveUnix: null,
                    durationSec: null,
                });
                seen.add(cf.file.file);
            }
        }
        for (const c of allCandidates) {
            const firstSynced = firstSyncedRecord(c.records);
            if (firstSynced && !seen.has(c.file)) {
                tzSamples.push({
                    file: { file: c.file, relativePath: c.relativePath },
                    fingerprint: c.fingerprint,
                    firstGpsUnix: firstSynced.unixSeconds,
                    mvhdNaiveUnix: c.createdUtc !== null ? c.createdUtc.getTime() / 1000 : null,
                    durationSec: c.durationSec,
                });
                seen.add(c.file);
            }
        }
    }
    const tzByFingerprint = estimateTzByFingerprint(tzSamples, classifyFilenameTime);
    const preciseOffsetRuns = estimatePreciseClockOffsetByFingerprint(tzSamples, classifyFilenameTime);

    // Filename-first path for slow random-access backends (Android SD-over-OTG):
    // render the trip list from filenames now and hydrate each trip's bytes on
    // open. The probe forces "eager" until LAZY_ENABLED flips after device
    // validation, so this branch is dormant today (zero behavior change).
    const ingestScheduler = await pickIngestScheduler(newVideos.map((cf) => cf.file));
    if (ingestScheduler === "lazy") {
        await runLazyHydration({
            newVideos,
            allCandidates,
            logExtractorByMp4: logsResult.extractorByMp4,
            sidecarExtractorByMp4: sidecarResult.extractorByMp4,
            // Accel-only sidecars (.3gf G-force) are merged into GpsRecords once a
            // trip has a real startUtc - mirrors the eager tail (mergeAccelSamples).
            accelByMp4: accelSidecarResult.accelByMp4,
            // Log/sidecar parse errors are already known at the branch point (they
            // are parsed before this) - report them instead of a hardcoded 0.
            parseErrorsCount: logsResult.errors.length + sidecarResult.errors.length + accelSidecarResult.errors.length,
            tzByFingerprint,
            preciseOffsetRuns,
            ingestStart,
            signal,
        });
        // If the user cancelled inside the scheduler-probe window, runLazyHydration
        // returned WITHOUT starting a fill (and without committing anything), while
        // the previous drop's fill was already torn down at entry. Restart it so
        // those trips do not stay provisional forever (A2/A3 edge). In the normal
        // case the signal is not aborted and runLazyHydration owns its own fill.
        if (signal.aborted) resumeLazyHydrationIfPending();
        return;
    }

    // Progressive indexing: add VideoCandidate to the pool on the fly and rebuild trips every PARTIAL_BATCH_SIZE files.
    // The user sees trips appearing and can start watching before all indexing finishes (on 500 files this saves ~1 minute of perceived wait).
    let indexFailed = 0;
    let batchCount = 0;
    const PARTIAL_BATCH_SIZE = 20;
    // Wall-clock throttle for the progressive regroup. applyPartial is O(all
    // candidates + all GPS records + full sidebar DOM), so on a large card the
    // every-20-files cadence stalls the main thread and delays Cancel handling.
    // Skip an intermediate pass that lands within PARTIAL_MIN_INTERVAL_MS of the
    // previous one; the FINAL pass (done===total) always runs, and the
    // unconditional recomputeAllStartUtc after indexing guarantees the end state
    // is correct regardless of which intermediate passes were dropped (B1).
    const PARTIAL_MIN_INTERVAL_MS = 700;
    let lastPartialMs = 0;
    // Container repairs are now detected inside the indexer worker (it already
    // holds the moov bytes) and applied per-file in the index callback below,
    // overlapped with the rest of indexing. These counters drive the post-ingest
    // toasts + the "ingest done" summary; they used to be filled by two separate
    // post-index stages that each re-read the moov on the main thread.
    let repairedCount = 0; // broken hvcC fixed (HEVC firmware quirks)
    let phantomRepairedCount = 0; // phantom no-data tracks neutralized

    const applyPartial = () => {
        // addedKeys commits HERE (the point where candidates actually reach
        // state.trips via recomputeAllStartUtc), NOT in the per-file indexer
        // callback. The re-drop filter consults addedKeys, so marking a file
        // "added" before its commit point meant a cancel mid-batch stranded
        // up to PARTIAL_BATCH_SIZE-1 indexed-but-uncommitted files - filtered
        // out of every future re-drop until page reload. Set.add is
        // idempotent; re-adding carried-over keys is free.
        for (const c of allCandidates) {
            state.addedKeys.add(vendorFileKey({ file: c.file, relativePath: c.relativePath }));
        }
        // Pull in records: the GPS log is already parsed, but new files may have had empty records if the log arrived later.
        // recomputeAllStartUtc then estimates TZ from collected mvhd pairs and updates startUtc via deriveStartUtc.
        if (state.gpsLog) {
            for (const c of allCandidates) {
                const newRecords = state.gpsLog.byFilename.get(c.file.name);
                if (newRecords && newRecords.length > 0) c.records = newRecords;
            }
        }
        recomputeAllStartUtc(allCandidates);
        // No auto-select of the first trip - the user picks. Empty-state stays visible until state.active !== null.
    };

    // indexAllMp4Files runs in a worker. MP4 path: single moov walk yields
    // duration/codec/rotation/hvcC. TS path: mediabunny.computeDuration.
    // We also request moov bytes (withMoovBytes: true) and forward them to
    // gps-extract in batches as files are indexed (per-batch flush, see
    // EMBEDDED_BATCH_SIZE below) - the gps-extract worker reuses them via
    // its prebuiltMoovByPath path, eliminating the duplicate moov read
    // on cold SD AND avoiding the heap spike that accumulating moov bytes
    // for all 240 files would cause before transfer.
    const newRawFiles = newVideos.map((c) => c.file.file);
    const byFile = new WeakMap<File, (typeof newVideos)[number]>();
    for (const cf of newVideos) byFile.set(cf.file.file, cf);

    // Streaming embedded-GPS dispatch. Each batch of ~EMBEDDED_BATCH_SIZE
    // freshly indexed files is shipped to gps-extract immediately, in
    // parallel with the rest of the indexer. The transferable moov bytes
    // leave main heap as soon as the batch postMessage fires. cloneAcrossGroup
    // affinity (Juscar F/R/I) is preserved as long as all members of a group
    // land in the same batch - with batch size 16 and indexer concurrency 4
    // this holds for the common 2-4 member groups (members arrive close
    // together because they are adjacent in newRawFiles).
    const EMBEDDED_BATCH_SIZE = 16;
    let pendingBatch: (typeof newVideos)[number][] = [];
    let pendingBatchMoov: Map<string, Uint8Array> = new Map();
    const embeddedBatchPromises: Promise<DispatchedEmbeddedGpsResult>[] = [];
    let embeddedTotal = 0;
    let embeddedDone = 0;
    // While the indexer is still running, the overlay shows "Indexing X/Y".
    // Per-batch progress increments embeddedDone silently in that window; only
    // after the indexer finishes (and the tail batch is dispatched) does the
    // overlay flip to "Embedded GPS X/Y" with the current cumulative counter.
    // Without this, the label flickers between the two stages on every batch
    // flush mid-indexing.
    let indexingFinished = false;

    const dispatchPendingBatch = (): void => {
        if (pendingBatch.length === 0) return;
        const batch = pendingBatch;
        const batchMoov = pendingBatchMoov;
        pendingBatch = [];
        pendingBatchMoov = new Map();
        const batchPromise = dispatchParseVideoEmbeddedGps(
            batch,
            (_done, _total, _file) => {
                embeddedDone++;
                if (!indexingFinished) return;
                setIngestStage(
                    t("ingestOverlay.stage.embeddedGps", {
                        done: embeddedDone,
                        total: embeddedTotal,
                    }),
                );
                setIngestProgress({ done: embeddedDone, total: embeddedTotal });
            },
            /* concurrency */ 4,
            signal,
            "light-only",
            batchMoov,
        );
        // These batches start running during indexMp4 but are only awaited
        // (Promise.all) much later. If the user cancels mid-index, repair, or
        // codec-check, ingestFilesInternal throws AbortError before that await
        // is reached - orphaning these promises, whose own AbortError would then
        // surface as an unhandledrejection (ring-buffer noise + a false
        // app_uncaught_error in analytics). A synchronous no-op rejection
        // handler marks them handled; the Promise.all join still observes the
        // real result/rejection.
        batchPromise.catch(() => {});
        embeddedBatchPromises.push(batchPromise);
    };

    if (signal.aborted) throw new DOMException("ingest aborted", "AbortError");
    setIngestStage(t("ingestOverlay.stage.indexing", { done: 0, total: newRawFiles.length }));
    // UX-02: indexing is the first stage with a known total - switch the progress bar to determinate mode. Embedded GPS loads below.
    setIngestProgress({ done: 0, total: newRawFiles.length });
    await mark("indexMp4", () =>
        indexAllMp4Files(
            newRawFiles,
            (done, total, file, idx, moovBytes, repair) => {
                setIngestStage(t("ingestOverlay.stage.indexing", { done, total }));
                setIngestProgress({ done, total });

                if (!idx) {
                    indexFailed++;
                    state.unindexed.push(file);
                } else {
                    const cf = byFile.get(file)!;
                    // Apply container repair the indexer worker detected from the
                    // moov bytes it already read (phantom no-data track / broken
                    // hvcC). The patched moov is spliced back zero-copy on main;
                    // the GPS-extract batch still uses the original cf.file (the
                    // edits never touch GPS atoms/tracks). null = clean moov.
                    const repairApplied = applyIndexRepair(file, idx.needsHevcRemux, repair);
                    const candidateFile = repairApplied.file;
                    const candidateNeedsHevcRemux = repairApplied.needsHevcRemux;
                    if (repair) {
                        if (repairApplied.phantomRepaired) phantomRepairedCount++;
                        if (repairApplied.hvccRepaired) repairedCount++;
                        log.info("applied container repair", {
                            file: file.name,
                            phantom: repair.phantomNeutralized,
                            hvcc: repair.hvcc?.reason ?? null,
                        });
                    }
                    // NOTE: addedKeys is deliberately NOT updated here - it
                    // commits in applyPartial together with state.trips.
                    const records = state.gpsLog?.byFilename.get(file.name) ?? [];
                    // Whether to extract embedded GPS is decided by the file's
                    // source hint alone (planEmbeddedGpsQueue), NOT by whether
                    // we have moov bytes to cache. MPEG-TS has no moov, so
                    // moovBytes is undefined for it; gating the queue on
                    // moovBytes silently dropped every TS file (Juscar) from
                    // extraction, so their embedded GPS never loaded. The moov
                    // cache is a pure read-saving optimization on top.
                    const gpsPlan = planEmbeddedGpsQueue(cf.file, records.length > 0, moovBytes != null);
                    if (gpsPlan.queue) {
                        pendingBatch.push(cf);
                        // Cache moov bytes only when present (MP4/MOV). Key by
                        // relativePath (vendorFileKey), not basename: two files
                        // with the same basename in different folders
                        // (channel-in-folder cameras, 70mai .s_* proxies before
                        // they are filtered) would otherwise share one moov
                        // buffer - and the buffer is transferred to the worker,
                        // so the second send hits a detached ArrayBuffer.
                        // Holding moov bytes (~100KB-2MB each) only for files
                        // that will be extracted keeps heap bounded on 240-file
                        // mobile drops; unkept bytes are detached-transferable
                        // and GC immediately.
                        if (gpsPlan.cacheMoov && moovBytes) {
                            pendingBatchMoov.set(vendorFileKey(cf.file), moovBytes);
                        }
                        embeddedTotal++;
                        if (pendingBatch.length >= EMBEDDED_BATCH_SIZE) {
                            dispatchPendingBatch();
                        }
                    }
                    const fingerprint = cameraFingerprint(cf.file);
                    // Hoisted: isTimelapse feeds the wall-span/anchor derivation
                    // below AND the candidate literal.
                    const classifierFields = filenameClassifierFields(cf.file);
                    const filenameLocal = classifyFilenameTime(cf.file);
                    const wallDurationSec = deriveWallDurationSec({
                        isTimelapse: classifierFields.isTimelapse,
                        durationSec: idx.durationSec,
                        createdUtc: idx.createdUtc,
                        records,
                        filenameNaiveSec: filenameLocal !== null ? filenameLocal.getTime() / 1000 : null,
                    });
                    // Initial build runs before embedded GPS extraction returns,
                    // so no hint yet. applyEmbeddedResultToState fills the field
                    // later and recomputeAllStartUtc re-derives with the hint.
                    const { startUtc, source } = deriveStartUtc({
                        file: cf.file,
                        fingerprint,
                        createdUtc: idx.createdUtc,
                        durationSec: idx.durationSec,
                        records,
                        fingerprintTz: tzByFingerprint.get(fingerprint) ?? null,
                        parseFilenameLocalTime: classifyFilenameTime,
                        preciseFilenameOffsetSec: resolvePreciseClockOffsetForFile(
                            preciseOffsetRuns,
                            fingerprint,
                            cf.file,
                            classifyFilenameTime,
                        ),
                        embeddedStartUtcHint: null,
                        isTimelapse: classifierFields.isTimelapse,
                        wallDurationSec,
                    });
                    // Carry forward attribution from the log/sidecar stages so
                    // diagnostics show e.g. csv-70mai for files whose GPS came
                    // from the sidecar. Embedded extraction adds its own
                    // attribution later via applyEmbeddedResultToState.
                    const initialApplied: string[] = [];
                    const fromLog = logsResult.extractorByMp4.get(file.name);
                    if (fromLog) initialApplied.push(fromLog);
                    const fromSidecar = sidecarResult.extractorByMp4.get(file.name);
                    if (fromSidecar) initialApplied.push(fromSidecar);
                    allCandidates.push({
                        // Patched file when the worker repaired this file's moov,
                        // else the original. Playback/preview/export use this one.
                        file: candidateFile,
                        relativePath: cf.file.relativePath,
                        fingerprint,
                        appliedExtractors: initialApplied,
                        // Filename-derived fields - shared with the provisional
                        // builder so the two paths cannot drift.
                        ...classifierFields,
                        startUtc,
                        durationSec: idx.durationSec,
                        wallDurationSec,
                        startSource: source,
                        // Pre-index estimate (no mvhd yet); the unconditional
                        // recomputeAllStartUtc sweep refreshes it after indexing.
                        cameraTzSec: tzByFingerprint.get(fingerprint)?.filenameTzSec ?? null,
                        records,
                        createdUtc: idx.createdUtc,
                        codec: idx.codec,
                        rotation: idx.rotation,
                        width: idx.width,
                        height: idx.height,
                        fps: idx.fps,
                        audio: idx.audio,
                        // Optimistically true until the canPlay-batch check below. If codec=null it stays true (let <video> try).
                        canPlay: true,
                        codecParam: idx.codecParam,
                        videoCodecString: idx.videoCodecString,
                        // hvcC repair flips this to false (native path) when it
                        // rebuilt a previously-broken descriptor.
                        needsHevcRemux: candidateNeedsHevcRemux,
                        isTransportStream: isTransportStreamName(file.name),
                        isMatroska: isMatroskaName(file.name),
                        audioNeedsTranscode: idx.audioNeedsTranscode,
                        embeddedStartUtcHint: null,
                    });
                }

                batchCount++;
                const finalBatch = done === total;
                if (batchCount >= PARTIAL_BATCH_SIZE || finalBatch) {
                    batchCount = 0;
                    // Reset the batch counter even when the time throttle skips
                    // this pass, so the next attempt is another PARTIAL_BATCH_SIZE
                    // files out. Skipping applyPartial wholesale keeps addedKeys
                    // and state.trips in lock-step (both defer together), so the
                    // cancel-mid-batch invariant the commit-timing comment guards
                    // still holds.
                    const now = performance.now();
                    if (finalBatch || now - lastPartialMs >= PARTIAL_MIN_INTERVAL_MS) {
                        lastPartialMs = now;
                        applyPartial();
                    }
                }
            },
            /* concurrency */ 4,
            signal,
            { withMoovBytes: true },
        ),
    );
    // Tail flush: any files indexed in the trailing < EMBEDDED_BATCH_SIZE
    // window go out as one final batch. This must happen before HVCC repair
    // (so embedded GPS for the tail runs in parallel with repair) and before
    // the join at the embedded-GPS stage.
    dispatchPendingBatch();
    // Flip the stage label gate. From here on, in-flight batch callbacks
    // update the overlay; before this point they only increment counters.
    indexingFinished = true;
    if (embeddedTotal > 0) {
        setIngestStage(t("ingestOverlay.stage.embeddedGps", { done: embeddedDone, total: embeddedTotal }));
        setIngestProgress({ done: embeddedDone, total: embeddedTotal });
    }

    // TZ finalization via mvhd pairs: before indexing we only had filename-time (for NMEA sidecars that is nothing - filenames have no timestamp).
    // Now we have mvhd.creation_time for all indexed files, so TZ estimation can be more accurate.
    // See StartSource comments in trips.ts for why mvhd+TZ is preferred over GPS-first.
    recomputeAllStartUtc(allCandidates);

    // Start preview extraction now that indexing is done and trips are in
    // their near-final shape. Earlier (during indexing) would have made
    // preview workers contend with the SD reader; later (end of ingest)
    // would have meant "Continue without GPS" cancels embedded GPS via
    // AbortError -> the end-of-ingest schedule never fires -> placeholder
    // cards on already-loaded videos. This spot survives that cancel path.
    // applyEmbeddedResultToState may re-schedule below if embedded results
    // shift trip boundaries so a split adds previewless trips - we keep
    // the latest promise so the post-ingest await sits on the right session.
    let lastPreviewPromise: Promise<void> = schedulePopulateTripPreviews(state.trips, updateTripPreview);

    // Container repairs (broken hvcC, phantom no-data tracks) were already
    // detected by the indexer worker from the moov bytes it read for indexing,
    // and applied per-file in the index callback above (repairedCount /
    // phantomRepairedCount were incremented there). This replaced two
    // post-index stages that each re-read the moov via findMoovInFile on the
    // main thread - 1-2 redundant moov reads per file on cold SD. The hvcC fix
    // already flipped VideoCandidate.needsHevcRemux to false where it applied,
    // so the canPlay check below sees the corrected playback path. See
    // src/repair/moov-repair.ts + src/repair/{hvcc,phantom-track}.ts.

    // canPlay check: query mediabunny canDecodeVideo for each distinct codec config
    // from the new files (mediabunny memoizes per config - duplicates are free). We
    // key on the full RFC 6381 string when present (videoCodecString), so HEVC
    // Main10 / a too-high level the browser cannot decode is rejected; otherwise we
    // fall back to the bare codec enum (mediabunny then assumes a generic, decodable
    // Main profile). not-decodable -> canPlay=false on every file with that config;
    // playFrame shows an overlay instead of a black <video>.
    // canPlay (codec decodability) - extracted to checkCanPlay so the lazy
    // hydration path runs the same probe over a single trip's candidates.
    await mark("codecCheck", () => checkCanPlay(allCandidates));

    // Embedded GPS from MP4 - two-stage scheme:
    //   1) Always run the "light-only" stage: parse what is available from the first 16 MB already read into Mp4Index (BlackVue X-series free->gps).
    //      Near-zero cost, no user prompt.
    //   2) If heavy files remain (Novatek streaming / GoPro GPMF / Garmin PNDM / Thinkware subtitle-NMEA / LigoGPS),
    //      show the prompt modal. "Yes" = bulk load under the same overlay; "No" = defer to state.pendingHeavyEmbeddedGps,
    //      lazy on-trip-click loads the selected trip's files (see lazy-embedded-gps.ts).
    //
    // Dispatch already ran in parallel with indexAllMp4Files via
    // dispatchPendingBatch above - moov bytes were shipped as soon as each
    // EMBEDDED_BATCH_SIZE-sized batch filled, plus a tail flush right after
    // indexing finished. embeddedBatchPromises now holds N in-flight
    // dispatches; here we join them.
    //
    // The pre-flight skip-reason audit (sourceHints) happens inline in the
    // indexer onProgress: planEmbeddedGpsQueue controls whether a file enters
    // pendingBatch. Files that fail the gate are silently dropped here (any
    // moov bytes they had are GC'd since the indexer-side ntf already detached
    // them on transfer; only queued files held a reference past that point).
    let heavyPending: DispatchedEmbeddedGpsResult["heavyFiles"] = [];
    let embeddedResult: DispatchedEmbeddedGpsResult = {
        appliedExtractors: [],
        records: [],
        skipped: [],
        errors: [],
        winningExtractorByFilename: new Map(),
        videoStartUtcHintByFilename: new Map(),
        accelByFilename: new Map(),
        heavyFiles: [],
    };
    // Skip-reason audit: log the breakdown of why some videos did not
    // contribute to embedded GPS. Kept for parity with the previous behavior
    // (one log line per ingest for debugging GPS source-hint regressions).
    const skipBySource = new Map<string, number>();
    let skippedCount = 0;
    for (const cf of newVideos) {
        const existing = state.gpsLog?.byFilename.get(cf.file.file.name);
        const hasRecords = !!(existing && existing.length > 0);
        if (shouldTryEmbeddedGps(cf.file, hasRecords)) continue;
        const reason = hasRecords ? "already-has-records" : `source:${classifyGpsSource(cf.file)}`;
        skipBySource.set(reason, (skipBySource.get(reason) ?? 0) + 1);
        skippedCount++;
    }
    if (skippedCount > 0) {
        log.info("skipping embedded GPS pre-flight", {
            skipped: skippedCount,
            total: newVideos.length,
            byReason: Object.fromEntries(skipBySource),
        });
    }
    if (embeddedBatchPromises.length > 0) {
        if (signal.aborted) throw new DOMException("ingest aborted", "AbortError");
        // Indexing already committed VideoCandidates progressively, so cancel
        // here means "stop parsing GPS, keep loaded videos". Surface that as
        // a friendlier label instead of the generic "Cancel".
        setIngestCancelLabel(true);
        try {
            // Per-batch settle, NOT Promise.all: a worker crash (one
            // pathological file OOMing the gps-extract worker) rejects only
            // its own batch. Promise.all turned that into a whole-ingest
            // failure, discarding every other batch's GPS even though the
            // trips themselves loaded fine - violating the "one bad file must
            // not abort ingest" invariant. AbortError still propagates: that
            // is the user cancelling the stage, not a batch failing.
            const settled = await mark("embeddedGps", () => Promise.allSettled(embeddedBatchPromises));
            const fulfilled: DispatchedEmbeddedGpsResult[] = [];
            const crashed: string[] = [];
            for (const s of settled) {
                if (s.status === "fulfilled") {
                    fulfilled.push(s.value);
                } else if (s.reason instanceof DOMException && s.reason.name === "AbortError") {
                    throw s.reason;
                } else {
                    crashed.push(String(s.reason));
                }
            }
            embeddedResult = mergeEmbeddedResults(fulfilled);
            if (crashed.length > 0) {
                // Surfaced through the same channel as per-file parse errors
                // (warn log + Sentry report below), so a crash class is still
                // visible in diagnostics.
                embeddedResult.errors.push(
                    ...crashed.map((message) => ({ file: "<batch>", extractor: "gps-extract-worker", message })),
                );
            }
        } finally {
            setIngestCancelLabel(false);
        }
        heavyPending = embeddedResult.heavyFiles;
        applyEmbeddedResultToState(embeddedResult, allCandidates);
        if (embeddedResult.records.length > 0) {
            // Embedded records caused a regroup (see applyEmbeddedResultToState);
            // a trip may have split across TRIP_GAP and the new half has no
            // preview. Re-schedule. Aborts the in-flight session - carryOver
            // already moved existing previews onto the new Trip objects, so
            // the only real work the new session does is the orphan halves.
            lastPreviewPromise = schedulePopulateTripPreviews(state.trips, updateTripPreview);
        }
        if (embeddedResult.errors.length > 0) {
            log.warn("embedded gps parse errors", {
                count: embeddedResult.errors.length,
                errors: embeddedResult.errors,
            });
            reportParseErrorsToSentry("embedded", embeddedResult.errors);
        }
    }

    // Heavy files (Novatek streaming where the predicted-offset jump scan
    // could not bootstrap - no seeds in the probe window) are deferred to
    // lazy on-trip-click. No modal prompt: jump-scan-eligible "mid" files
    // are already auto-parsed in the light-only stage above (~30 MB IO each),
    // so what reaches here is exclusively the no-seeds edge case which is
    // rare in practice.
    if (heavyPending.length > 0) {
        for (const cf of heavyPending) {
            // vendorFileKey (path-qualified), not basename: the lazy on-trip-click
            // reader keys by the same, so two same-named files across drops cannot alias.
            state.pendingHeavyEmbeddedGps.set(vendorFileKey(cf.file), cf);
        }
        log.info("heavy embedded gps deferred to lazy on-trip-click", {
            pending: heavyPending.length,
        });
    }

    // Merge accel into existing GpsRecord by nearest unixSeconds - from the
    // accel-only sidecars (.3gf) and from whatever the embedded extraction found
    // inside the containers themselves.
    // At this point all files have startUtc (recomputeAllStartUtc ran) and records (from gpsLog or embedded).
    // Without startUtc, relative msSinceStart cannot be converted to absolute unix.
    const accelByMp4 = combineAccelSources(accelSidecarResult.accelByMp4, embeddedResult.accelByFilename);
    if (accelByMp4.size > 0 && state.gpsLog) {
        const startUtcByMp4 = new Map<string, number>();
        for (const c of allCandidates) {
            // Basename key (NOT vendorFileKey) on purpose: mergeAccelSamples joins
            // accelByMp4 <-> records <-> startUtc all by basename (GpsRecord.mp4Filename,
            // the parser contract), and the .3gf sidecar itself pairs only by basename,
            // so a same-basename collision is inherent to the format and a path-qualified
            // key here would just desync this map from the other two. startUtc is unix
            // seconds (number, see trips.ts VideoCandidate).
            startUtcByMp4.set(c.file.name, c.startUtc);
        }
        const mutated = mergeAccelSamples(state.gpsLog.records, accelByMp4, startUtcByMp4);
        if (mutated > 0) {
            // GpsRecords were mutated in-place; byFilename Map still points to the same objects as records[], so no rebuild is needed.
            log.info("merged accel samples", {
                mutatedRecords: mutated,
                sidecarFiles: accelSidecarResult.accelByMp4.size,
                embeddedFiles: embeddedResult.accelByFilename.size,
            });
            // Trips were finalized (and their events detected) before the accel
            // arrived, so without this rebuild a .3gf camera shows no braking
            // events at all on this path - the lazy path merges before its
            // per-trip refresh and did surface them.
            for (let i = 0; i < state.trips.length; i++) refreshTrip(i);
            renderTrips();
        }
    }

    // Surface exceptional outcomes as individual notification toasts so each
    // one is acknowledged separately and stays in the bell drawer history.
    // Silent on clean ingest - the trip list is the visible feedback.
    if (indexFailed > 0) {
        notify({ severity: "warn", messageKey: "status.badFilesSkipped", messageParams: { n: indexFailed } });
    }
    if (repairedCount > 0) {
        notify({ severity: "info", messageKey: "status.hvccRepaired", messageParams: { n: repairedCount } });
    }
    if (phantomRepairedCount > 0) {
        notify({ severity: "info", messageKey: "status.audioDamaged", messageParams: { n: phantomRepairedCount } });
    }

    // Nothing playable came out of the drop (all junk, all MP4s failed to
    // index, or only sidecars with no video). Reaching here with zero trips
    // means there were no pre-existing trips either (the re-render path above
    // returns early when trips already exist), so without this toast the
    // overlay just vanishes and the landing screen stays with no explanation.
    // Skip when the unsupported-formats modal already explained the outcome
    // (it covers the .avi/.wmv/.3gp/... unplayable-container case).
    if (state.trips.length === 0 && unplayableByExt.size === 0) {
        // "Dropped a card, nothing opened" - the clearest new-camera demand
        // signal. Send only the extension histogram (pure format signal, no
        // PII); NOT filenames or the fallback fingerprint (which can leak a
        // user folder name).
        captureSentryMessage("ingest produced no playable trips", {
            level: "warning",
            fingerprint: ["ingest_nothing_loaded"],
            extra: { byExtension: countByExtension(vfiles), fileCount: vfiles.length },
        });
        if (looksLikeRecordings(vfiles)) {
            // Recordings were present but nothing was recognised - almost always
            // an unsupported camera. Offer the "we couldn't read this card" flow
            // (routes into the feedback form) instead of a dead-end toast.
            showNoRecordingsModal();
        } else {
            // No video-like files at all - the user dropped the wrong folder.
            // A bare toast is the right amount of noise; no offer to "help add".
            notify({ severity: "warn", messageKey: "status.nothingLoaded" });
        }
    }

    // Keep the overlay up until previews are ready so the user does not see
    // the sidebar in placeholder state right after the modal disappears.
    // The preview worker pool runs independently of the ingest signal -
    // raceWithAbort lets the user dismiss via Cancel without waiting for
    // every preview to finish, while still letting the workers complete in
    // the background and fill cards reactively via updateTripPreview.
    setIngestStage(t("ingestOverlay.stage.previews"));
    setIngestProgress({ mode: "indeterminate" });
    await raceWithAbort(lastPreviewPromise, signal);

    // Per-record skip summary. Parsers aggregate malformed GPS rows (bad
    // hemisphere byte, out-of-range coords, NaN, ...) into gpsLog.skipped instead
    // of logging per-iteration (hot path). Surface the aggregate once so a "half
    // my track is missing / chart has holes" report shows how many rows were
    // dropped and why. Log only - a few cold-start rows are normal; not a toast.
    // Only THIS ingest's rows (delta vs the baseline snapshot taken at ingest
    // start): gpsLog accumulates across ingests, and a cumulative total here
    // misleads exactly the "half my track is missing" reports it exists for.
    const skippedLines = (state.gpsLog?.skipped ?? []).slice(skippedLinesBaseline);
    if (skippedLines.length > 0) {
        const byReason = new Map<string, number>();
        for (const s of skippedLines) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
        log.warn("gps records skipped", {
            total: skippedLines.length,
            byReason: Object.fromEntries(byReason),
        });
    }

    // Final info log: outcome + where time was spent. Source of truth for "why is ingest slow" / "how many trips" / "how many GPS records" in bug reports.
    log.info("ingest done", {
        durationMs: Math.round(performance.now() - ingestStart),
        stageMs,
        tripsCount: state.trips.length,
        videosTotal: allCandidates.length,
        videosNew: newVideos.length,
        gpsRecordsTotal: state.gpsLog?.records.length ?? 0,
        indexFailedCount: indexFailed,
        repairedHvccCount: repairedCount,
        repairedPhantomCount: phantomRepairedCount,
        errorCounts: {
            logs: logsResult.errors.length,
            sidecars: sidecarResult.errors.length,
            accelSidecars: accelSidecarResult.errors.length,
        },
    });

    // Onboarding tour after the first successful ingest - the peak-value moment,
    // right after the user has just seen their trip. maybeRunIngestTour is
    // self-guarded (localStorage flag + single-run).
    if (state.trips.length > 0) maybeRunIngestTour();

    // Install toast - one-shot after the first successful ingest (peak-value
    // moment: the user has just seen their trip and is most receptive to
    // "pin it to your dock"). The module decides whether to actually show
    // it (strategy + cooldown).
    if (state.trips.length > 0) void maybeShowPostIngestToast();

    // Lifecycle signal for external observers (perf harness, future
    // integrations). Fires only on the success path - cancellation and
    // failure go through the catch in ingestFiles and skip this.
    emitLifecycle("ingest-done", {
        tripsCount: state.trips.length,
        videosTotal: allCandidates.length,
        gpsRecordsTotal: state.gpsLog?.records.length ?? 0,
        durationMs: Math.round(performance.now() - ingestStart),
    });

    // An eager drop indexes only its own new files; candidates carried over from
    // a previous LAZY drop that are still un-hydrated were never re-read here.
    // cancelLazyHydration killed their fill at entry, so restart it now (A2) -
    // no-op when nothing is pending (a pure eager session).
    resumeLazyHydrationIfPending();
}

/**
 * Forwards per-stage GPS parse FAILURES to crash reporting, grouped by extractor
 * id (one event per extractor, not per file - a 200-file drop with one bad
 * format is a single event). The signal answers "which format crashes on real
 * samples" - the demand list for new-format work. PII discipline: only the
 * extractor id + count cross the network; the file name and raw message (which
 * can embed a filename) stay in the local ring buffer. WrongFormatError is a
 * marker false-positive (control flow), not collected here - it never reaches
 * the *.errors arrays.
 */
function reportParseErrorsToSentry(
    stage: string,
    errors: ReadonlyArray<{ extractor?: string; sidecarId?: string }>,
): void {
    if (errors.length === 0) return;
    // log/embedded errors carry `extractor`, sidecar/accel carry `sidecarId`.
    const byParser = new Map<string, number>();
    for (const e of errors) {
        const parser = e.extractor ?? e.sidecarId ?? "unknown";
        byParser.set(parser, (byParser.get(parser) ?? 0) + 1);
    }
    for (const [parser, count] of byParser) {
        captureSentryMessage("gps parse failed", {
            level: "warning",
            fingerprint: ["gps_parse_failed", stage, parser],
            tags: { stage, parser },
            extra: { count },
        });
    }
}

/**
 * Re-estimates camera TZ from (filename + mvhd, GPS first) pairs, re-derives
 * startUtc/source on every candidate, then regroups into trips and rebuilds the
 * sidebar. Idempotent. Fires repeatedly during ingest:
 *   - once per PARTIAL_BATCH_SIZE files during indexing (progressive UX),
 *   - after the full index pass (mvhd now complete, TZ estimate refined),
 *   - after embedded-GPS merge (records may appear for previously empty files).
 * Trip preview generation is NOT scheduled here - the caller decides when to do
 * it (deferred to end-of-ingest so preview workers do not contend with the SD
 * reader during indexing). carryOverTripPreviews keeps the existing previews
 * visible across the regroup.
 */
export function recomputeAllStartUtc(candidates: VideoCandidate[]): void {
    // Re-derive every candidate's anchor from its current createdUtc/records
    // (TZ + clock-offset estimated from the same set). Shared with the lazy
    // per-trip hydration so both paths anchor identically.
    rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
    // Carry previewDataUrl across the regroup so the sidebar does not flash to
    // placeholders mid-ingest (groupTrips builds fresh Trip objects) - see
    // applyRegroup / carryOverTripPreviews.
    applyRegroup(candidates);
    renderTrips();
}

// Wire recomputeAllStartUtc as the lazy path's final regroup sweep. It lives here
// (lazy-hydrate cannot import ingest without a cycle - ingest imports lazy-hydrate
// for the seam), so ingest pushes it across at module load via the init callback.
registerRecomputeSweep(recomputeAllStartUtc);

/** Rebuilds state.trips from the current file set when the log or add order changed but re-indexing is not needed. */
function rebuildTripsFromCurrentFiles(): void {
    const candidates = state.trips.flatMap(tripAllCandidates);
    if (state.gpsLog) {
        for (const c of candidates) {
            c.records = state.gpsLog.byFilename.get(c.file.name) ?? [];
        }
    }
    // GPS just arrived for these files (the "drop a GPX later" flow): re-anchor
    // startUtc/startSource from the now-present records, exactly like every
    // other records-arrival path (recomputeAllStartUtc, applyEmbeddedResultToState).
    // Without it the anchor stays name-in-local-TZ or mtime, so the marker/chart
    // stay offset from the video, the mtime warning lingers, and cold-start
    // ~1970 rows never get reanchored (A6).
    rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
    applyRegroup(candidates);
    schedulePopulateTripPreviews(state.trips, updateTripPreview);
}

/**
 * Applies a dispatchParseVideoEmbeddedGps result (light-only or heavy) to global state and the local candidate pool:
 *   - merges records into state.gpsLog with dedup (re-dropping the same file must not double the track);
 *   - pulls records from byFilename into each candidate;
 *   - calls recomputeAllStartUtc - GPS appearing for a file may change the TZ estimate or shift startUtc across the 30-second trip-gap boundary.
 *
 * Note: there is no vendorId in this architecture, so no "vendor upgrade"
 * step is needed - channel/sequence/mode come from filename classifiers and
 * do not change based on which extractor produced the GPS.
 *
 * Returns silently only when the result carries NEITHER records NOR frame-0
 * hints (see embeddedResultHasEffect).
 */
function applyEmbeddedResultToState(result: DispatchedEmbeddedGpsResult, allCandidates: VideoCandidate[]): void {
    if (!embeddedResultHasEffect(result)) return;
    state.gpsLog = mergeIntoGpsLog(state.gpsLog, result);
    for (const c of allCandidates) {
        const recs = state.gpsLog.byFilename.get(c.file.name);
        if (recs && recs.length > 0) c.records = recs;
        // Record the extractor that produced GPS for this file - for diagnostics.
        const winningExtractor = result.winningExtractorByFilename.get(c.file.name);
        if (winningExtractor && !c.appliedExtractors.includes(winningExtractor)) {
            c.appliedExtractors.push(winningExtractor);
        }
        // Authoritative video frame-0 wall-clock from the extractor (RVMI tReV).
        // Picked up by deriveStartUtc to skip mvhd/firstGps inference. Only set
        // here - it survives later recomputes via the candidate field itself.
        const hint = result.videoStartUtcHintByFilename.get(c.file.name);
        if (hint !== undefined) c.embeddedStartUtcHint = hint;
    }
    // Diagnostic: confirm which files actually received embedded GPS. The
    // transport-stream breakdown is the one to watch - MPEG-TS (Juscar) was the
    // container that silently got no GPS when the queue was gated on moov bytes.
    log.debug("embedded gps applied", {
        recordsInBatch: result.records.length,
        extractors: result.appliedExtractors,
        withRecords: allCandidates.filter((c) => c.records.length > 0).length,
        total: allCandidates.length,
        transportStream: allCandidates
            .filter((c) => c.isTransportStream)
            .map((c) => ({ file: c.file.name, recs: c.records.length })),
    });
    recomputeAllStartUtc(allCandidates);
    // Caller (ingestFilesInternal) re-schedules previews after this since
    // the regroup may split trips and add previewless halves. Doing it here
    // would hide the latest preview promise from the ingest awaiter.
}

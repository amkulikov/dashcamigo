// Filename-first ingest + lazy per-trip hydration. The alternative ingest path
// for slow random-access backends (Android SD-over-OTG / SAF), where each
// File.slice() is a multi-ms IPC round-trip and the per-file moov walk on the
// critical path makes the trip list appear slowly.
//
// Idea: directory enumeration gives name/size/mtime for FREE (no content read),
// and the whole trip-list structure (fingerprint, channel/mode/sequence,
// filename-time -> startUtc) is derivable from the filename alone. So we render
// the sidebar from filenames the instant the folder is dropped (zero byte
// reads), with a per-fingerprint PROVISIONAL duration so groupTrips works, then
// hydrate exact metadata (duration/codec/createdUtc/GPS/preview) lazily:
//   - the opened trip first (awaited before playback);
//   - the rest in a low-priority idle background fill;
//   - a single global regroup sweep at the end reconciles boundaries with the
//     now-real durations and re-derives startUtc from real mvhd/GPS.
//
// Gating: the eager pipeline (ingest.ts) stays the path for fast backends; this
// path is selected by pickIngestScheduler only when a backend probe measures
// slow slices AND there are enough files to matter. A localStorage override
// forces a path (used by e2e + manual testing). The desktop path is unaffected:
// even with the feature on, a fast backend probes eager.

import { indexAllMp4Files } from "../indexer.js";
import { attachRecordsToCandidates, recordsForVideo, type VideoAssociationIndex } from "../gps-association.js";
import { createLogger } from "../log.js";
import { SLICE_COST_STREAM_ABOVE } from "../parsers/internal/mp4-walker.js";
import { cameraFingerprint } from "../parsers/camera-fingerprint.js";
import { classifyFilenameTime, classifyFilenameTimelapse } from "../parsers/filename/index.js";
import { shouldTryEmbeddedGps } from "../parsers/gps-source-hints.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import { combineAccelSources, mergeAccelSamples } from "../parsers/registry-light.js";
import type { AccelSample, GpsRecord, VendorFile } from "../parsers/types.js";
import { emitLifecycle } from "../perf.js";
import {
    applyTimelapseCadenceWallSpans,
    deriveStartUtc,
    estimatePreciseClockOffsetByFingerprint,
    estimateProvisionalDurationByFingerprint,
    estimateTzByFingerprint,
    finalizeFrameTiming,
    isHydrationPending,
    rederiveStartUtcForCandidates,
    resolvePreciseClockOffsetForFile,
    tripAllCandidates,
} from "../trips.js";
import type { VideoCandidate } from "../trips.js";

import { restampProvisionalMarkers } from "./annotations.js";
import { applyRegroup } from "./apply-regroup.js";
import { registerCandidateRepair, scheduleIndexCacheWrite } from "./ingest-cache.js";
import { fileIdentityOf } from "../persist/identity.js";
import { planEmbeddedGpsQueue } from "./embedded-gps-queue.js";
import { dispatchParseVideoEmbeddedGpsViaWorker as dispatchParseVideoEmbeddedGps } from "./gps-extract-shim.js";
import {
    buildProvisionalCandidate,
    checkCanPlay,
    hydrateCandidateFromIndex,
    vendorFileKey,
} from "./ingest-candidate.js";
import { applyLazyResultToState, refreshTrip } from "./lazy-embedded-gps.js";
import { closeLazyGpsLoadModal, showLazyGpsLoadModal, updateLazyGpsLoadModalProgress } from "./lazy-gps-load-modal.js";
import { maybeRunIngestTour } from "./onboarding.js";
import { maybeShowPostIngestToast } from "./pwa-install.js";
import { refreshTripCard, renderTrips, updateTripPreview } from "./sidebar.js";
import { state } from "./state.js";
import { ensureTripPreview, schedulePopulateTripPreviews } from "./trip-preview.js";

const log = createLogger("lazy-hydrate");

// === Backend probe + scheduler gate ===

// Bytes per probe read - one SAF round-trip; small enough that transfer time is
// negligible next to the per-call latency we are measuring.
const PROBE_BYTES = 4096;
// Below this file count the lazy scheduler's bookkeeping costs more than the
// first-paint it saves - a handful of clips index eagerly fast enough.
const LAZY_MIN_FILES = 30;
// Master switch. The gate (slow backend AND enough files) still decides per
// drop, so a fast backend (desktop) always stays eager even with this on; the
// switch is the kill-switch if the lazy path misbehaves on a real device.
const LAZY_ENABLED = true;
// localStorage override key: "lazy" or "eager" forces the path (e2e + manual
// testing on a fast backend, where the probe would otherwise pick eager).
const SCHEDULER_OVERRIDE_KEY = "dashcamigo:ingest-scheduler";

function schedulerOverride(): "eager" | "lazy" | null {
    try {
        const v = localStorage.getItem(SCHEDULER_OVERRIDE_KEY);
        return v === "lazy" || v === "eager" ? v : null;
    } catch {
        return null;
    }
}

/**
 * Decides eager vs lazy ingest. A localStorage override wins (testing). Else,
 * when the feature is on, a cheap backend latency probe times a few small
 * File.slice reads on the first video (median, to de-noise the cold-open
 * warm-up) and compares against SLICE_COST_STREAM_ABOVE - the same threshold
 * loadSamples uses to switch random->streaming. "lazy" requires both a slow
 * backend AND enough files to be worth it. Probe failures degrade to "eager".
 *
 * Short-circuits to "eager" without probing when the feature is off, so a fast
 * backend pays zero probe cost while disabled.
 */
export async function pickIngestScheduler(videoFiles: VendorFile[]): Promise<"eager" | "lazy"> {
    const override = schedulerOverride();
    if (override) {
        log.info("ingest scheduler override", { scheduler: override });
        return override;
    }
    if (!LAZY_ENABLED || videoFiles.length === 0) return "eager";

    const probe = videoFiles[0]!.file;
    const size = probe.size;
    // Three offsets (head / mid / tail). One cold slice carries the FS-open
    // warm-up SAF pays on every call anyway, but the median guards a fast
    // desktop backend from a single warm-up outlier reading as "slow".
    const offsets = [0, Math.floor(size / 2), Math.max(0, size - PROBE_BYTES)];
    const samples: number[] = [];
    for (const off of offsets) {
        try {
            const t0 = performance.now();
            await probe.slice(off, Math.min(off + PROBE_BYTES, size)).arrayBuffer();
            samples.push(performance.now() - t0);
        } catch {
            // A probe failure must not block ingest - just skip this sample.
        }
    }
    if (samples.length === 0) return "eager";
    samples.sort((a, b) => a - b);
    const medianSliceMs = samples[Math.floor(samples.length / 2)]!;
    const slowBackend = medianSliceMs > SLICE_COST_STREAM_ABOVE && videoFiles.length >= LAZY_MIN_FILES;
    const scheduler: "eager" | "lazy" = slowBackend ? "lazy" : "eager";
    log.info("ingest backend probe", {
        medianSliceMs: Math.round(medianSliceMs * 100) / 100,
        thresholdMs: SLICE_COST_STREAM_ABOVE,
        videoCount: videoFiles.length,
        slowBackend,
        scheduler,
    });
    return scheduler;
}

// === Final-sweep injection (init-callback, breaks the ingest<->lazy cycle) ===

// recomputeAllStartUtc lives in ingest.ts; ingest.ts registers it here (at its
// module load) so the lazy path can run the final global regroup without
// importing ingest.ts - that would be a cycle, since ingest.ts imports this
// module for the seam.
type RecomputeSweep = (candidates: VideoCandidate[]) => void;
let recomputeSweep: RecomputeSweep | null = null;

/** Wires recomputeAllStartUtc for the lazy final sweep. Called once from ingest.ts at module load. */
export function registerRecomputeSweep(fn: RecomputeSweep): void {
    recomputeSweep = fn;
}

// === Filename-first list build ===

/** Inputs runLazyHydration needs from the shared front half of ingestFilesInternal. */
export interface LazyHydrationContext {
    /** New (not-yet-added) video files classified by role. */
    newVideos: ClassifiedFile[];
    /** Carried-over candidates from existing state.trips (already hydrated). The
     *  provisional candidates are appended to this list before grouping. */
    allCandidates: VideoCandidate[];
    /** logsResult attribution keyed by vendorFileKey. */
    logExtractorByFileKey: Map<string, string>;
    /** sidecarResult attribution keyed by vendorFileKey. */
    sidecarExtractorByFileKey: Map<string, string>;
    /** BlackVue-style accel-only sidecar (.3gf) samples per video identity, merged
     *  into GpsRecords once a trip has a real startUtc (mirrors the eager tail). */
    accelByFileKey: Map<string, AccelSample[]>;
    /** All loaded + current videos, indexed once for O(1) basename lookup. */
    videoAssociation: VideoAssociationIndex;
    /** Log/sidecar parse errors known at the branch point, for the analytics event. */
    parseErrorsCount: number;
    tzByFingerprint: ReturnType<typeof estimateTzByFingerprint>;
    preciseOffsetRuns: ReturnType<typeof estimatePreciseClockOffsetByFingerprint>;
    ingestStart: number;
    signal: AbortSignal;
}

// Default duration fed to deriveStartUtc in the first (filename-only) pass: it
// only matters for files that already have log/sidecar GPS (window-fit checks),
// and the real value replaces it on hydration / the final sweep. 60 is the
// codebase's implicit clip-length unit (see GAP_DIVIDER_MIN_SEC).
const NOMINAL_DERIVE_DURATION_SEC = 60;

// The candidate pool of the current lazy ingest, for the final regroup sweep.
let lazyAllCandidates: VideoCandidate[] | null = null;
// This drop's accel-only sidecar (.3gf) samples, merged into GpsRecords per trip
// once startUtc is real (mirrors the eager tail's mergeAccelSamples). null/empty
// when the drop carries no accel sidecar.
let lazyAccelByFileKey: Map<string, AccelSample[]> | null = null;
// Accel the lazy embedded-GPS extraction found inside the videos themselves.
// Accumulated across per-trip hydrations (each pass covers one trip's files),
// unlike the sidecar map which is known in full at drop time.
let lazyEmbeddedAccelByFileKey = new Map<string, AccelSample[]>();

/**
 * Renders the trip sidebar from filenames alone (zero file-byte reads), then
 * starts low-priority background hydration. Replaces the eager
 * index->group->render core for slow backends. Returns once the list is on
 * screen; hydration continues afterwards.
 */
export async function runLazyHydration(ctx: LazyHydrationContext): Promise<void> {
    // Background fill from a previous drop was already superseded by
    // cancelLazyHydration in ingestFilesInternal; here we adopt this drop's state.
    lazyAccelByFileKey = ctx.accelByFileKey;

    // Derive a filename-only startUtc per new file (createdUtc/records may exist
    // from logs/sidecars; mvhd does not - that needs a moov read). Pass a nominal
    // duration: deriveStartUtc only uses it in the GPS/mvhd branches.
    const derived: Array<{
        cf: ClassifiedFile;
        fingerprint: string;
        startUtc: number;
        source: VideoCandidate["startSource"];
        records: VideoCandidate["records"];
    }> = [];
    for (const cf of ctx.newVideos) {
        const fingerprint = cameraFingerprint(cf.file);
        const records = state.gpsLog ? recordsForVideo(state.gpsLog, cf.file, ctx.videoAssociation) : [];
        const { startUtc, source } = deriveStartUtc({
            file: cf.file,
            fingerprint,
            createdUtc: null,
            durationSec: NOMINAL_DERIVE_DURATION_SEC,
            records,
            fingerprintTz: ctx.tzByFingerprint.get(fingerprint) ?? null,
            parseFilenameLocalTime: classifyFilenameTime,
            preciseFilenameOffsetSec: resolvePreciseClockOffsetForFile(
                ctx.preciseOffsetRuns,
                fingerprint,
                cf.file,
                classifyFilenameTime,
            ),
            embeddedStartUtcHint: null,
            // No moov yet (createdUtc null), so the mvhd-corroborated branches
            // the flag gates cannot fire here; the real wall span is derived in
            // the post-hydration rederive sweep.
            isTimelapse: classifyFilenameTimelapse(cf.file),
            wallDurationSec: null,
        });
        derived.push({ cf, fingerprint, startUtc, source, records });
    }

    // Provisional per-fingerprint duration from the inter-clip spacing of BOTH
    // new and already-present candidates (more samples per camera). groupTrips
    // then splits on real pauses; contiguous clips stay merged.
    const spacingSamples = [
        ...ctx.allCandidates.map((c) => ({ fingerprint: c.fingerprint, startUtc: c.startUtc })),
        ...derived.map((d) => ({ fingerprint: d.fingerprint, startUtc: d.startUtc })),
    ];
    const provisionalDuration = estimateProvisionalDurationByFingerprint(spacingSamples);

    for (const d of derived) {
        const appliedExtractors: string[] = [];
        const fileKey = vendorFileKey(d.cf.file);
        const fromLog = ctx.logExtractorByFileKey.get(fileKey);
        if (fromLog) appliedExtractors.push(fromLog);
        const fromSidecar = ctx.sidecarExtractorByFileKey.get(fileKey);
        if (fromSidecar) appliedExtractors.push(fromSidecar);
        ctx.allCandidates.push(
            buildProvisionalCandidate({
                file: d.cf.file,
                fingerprint: d.fingerprint,
                startUtc: d.startUtc,
                startSource: d.source,
                cameraTzSec: ctx.tzByFingerprint.get(d.fingerprint)?.filenameTzSec ?? null,
                durationSec: provisionalDuration.get(d.fingerprint) ?? NOMINAL_DERIVE_DURATION_SEC,
                records: d.records,
                appliedExtractors,
            }),
        );
    }

    // A Cancel during the (synchronous build + the abort-ignoring scheduler
    // probe) lands here. Bail BEFORE committing addedKeys: committing keys
    // without a matching state.trips update would filter every file out of a
    // re-drop until reload. The eager path fixed exactly this by committing keys
    // only alongside state.trips (see applyPartial), so the abort check goes
    // above the commit (A3).
    if (ctx.signal.aborted) return;

    // Carried-over candidates may be missing records that a just-merged GPS log
    // now provides (the user forgot the GPX on the first drop and included it
    // now). Mirror the eager applyPartial: pull records for EVERY candidate, not
    // just the new ones, so an old fully-hydrated trip picks up its track (#11).
    if (state.gpsLog) {
        attachRecordsToCandidates(state.gpsLog, ctx.allCandidates, ctx.videoAssociation);
    }

    // Wall spans for time-lapse runs, from filename cadence alone - the
    // provisional durations are per-fingerprint estimates, but the cadence
    // factor is a ratio over the same estimate, so a parked lapse night
    // bundles into one trip already in the instant list instead of jumping
    // from N trips to one at the final sweep.
    applyTimelapseCadenceWallSpans(ctx.allCandidates, classifyFilenameTime);

    lazyAllCandidates = ctx.allCandidates;
    // Full regroup invariant (remap active/expanded, carry previews, clear the
    // event cursor), not a bare state.trips assignment: a SECOND lazy drop onto
    // loaded+playing trips must keep the player pointed at the same trip and not
    // wipe previews. Identical to every other regroup site (A4).
    applyRegroup(ctx.allCandidates);

    // Commit addedKeys now that state.trips reflects them - the two must move
    // together so a Cancel can never leave keys committed for trips that were
    // never rendered (A3). "added" means "filename-known", not "fully indexed";
    // a reload loses un-hydrated state and the user re-drops. Mirrors eager.
    for (const c of ctx.allCandidates) {
        state.addedKeys.add(vendorFileKey(c));
    }

    renderTrips();

    log.info("filename-first list rendered", {
        trips: state.trips.length,
        newVideos: ctx.newVideos.length,
        candidates: ctx.allCandidates.length,
    });

    finishLazyIngest(ctx);
    startBackgroundFill();
}

// === Per-trip hydration ===

interface HydrateSession {
    controller: AbortController;
    completion: Promise<void>;
    /** Pending file count when the session started - the modal's progress total. */
    total: number;
    /** moov-stage progress sink. A foreground hydrateTrip sets this when it
     *  escalates to the blocking modal; background fill leaves it null (no UI). */
    onProgress: ((done: number, total: number) => void) | null;
    /** True while a foreground hydrateTrip (blocking modal) owns/joins this
     *  session. The background pump pauses while any session is foreground, so
     *  the two do not double the IO the user is waiting on (B5). */
    foreground: boolean;
}

// One session per trip index: background fill wants several trips in flight, and
// an explicit open joins the in-flight session for the same trip.
const sessions = new Map<number, HydrateSession>();

/** Whether any per-trip session is a foreground open (blocking modal). The
 *  background pump pauses while one is in flight so it does not double the IO
 *  the user is waiting on (B5). */
function anyForegroundSession(): boolean {
    for (const session of sessions.values()) if (session.foreground) return true;
    return false;
}

/**
 * Stops any in-flight hydration: aborts every session and supersedes the
 * background fill. Called at the start of each ingest so a previous drop's
 * background work cannot write onto the new drop's trips.
 */
export function cancelLazyHydration(): void {
    fillGeneration++;
    for (const session of sessions.values()) session.controller.abort();
    sessions.clear();
    state.hydratingTrips.clear();
    // Single reset point for this drop's per-drop state: release the previous
    // drop's candidate pool / accel samples so an intervening eager drop does not
    // pin them for the rest of the session (runLazyHydration re-adopts on a new
    // lazy drop). The fillGeneration bump already neutralizes any stale closure.
    lazyAllCandidates = null;
    lazyAccelByFileKey = null;
    lazyEmbeddedAccelByFileKey = new Map();
}

/**
 * Restarts the background fill if any loaded trip still has un-hydrated
 * candidates. The exit invariant for every ingest path that does NOT run
 * runLazyHydration (which starts its own fill): ingestFilesInternal tears the
 * fill down unconditionally at entry, so a second drop that early-returns
 * (all-duplicate re-drop, late GPS-log drop) or resolves eager would otherwise
 * leave the previous lazy drop's trips provisional forever - the final regroup
 * sweep, ingest_hydrated, and the aria-busy clear never run (A2).
 *
 * Rebuilds the pool from LIVE state.trips (not the stashed lazyAllCandidates,
 * which cancelLazyHydration nulled) so an intervening eager drop's candidates
 * join the final sweep. No-op when nothing is pending (the common eager-only
 * session).
 */
export function resumeLazyHydrationIfPending(): void {
    const pool = state.trips.flatMap(tripAllCandidates);
    if (!pool.some(isHydrationPending)) return;
    lazyAllCandidates = pool;
    startBackgroundFill();
}

/**
 * Whether a lazy background fill is still live: an in-flight per-trip session,
 * or an adopted candidate pool (a pump between idle ticks). Callers that
 * renumber state.trips out from under the fill (the settings trip-gap regroup)
 * use this to know they must cancel + resume it instead of corrupting its
 * index-keyed sessions. Conservative on purpose: it can stay true after a fill
 * fully completes (lazyAllCandidates lingers until the next ingest), which only
 * makes those callers do a harmless cancel + no-op resume.
 */
export function hasActiveLazySessions(): boolean {
    return sessions.size > 0 || lazyAllCandidates !== null;
}

/**
 * Returns the in-flight hydration session for a trip, creating one if the trip
 * has pending candidates (un-read moov, not terminally failed). Returns null
 * when there is nothing to do - every candidate is already hydrated or has
 * failed (the eager path, or an already-filled trip). Tracks the trip index in
 * state.hydratingTrips so the sidebar can show a per-card spinner. A foreground
 * open and the background fill share one session per trip.
 */
function ensureHydrateSession(tripIdx: number): HydrateSession | null {
    const trip = state.trips[tripIdx];
    if (!trip) return null;
    const existing = sessions.get(tripIdx);
    if (existing) return existing;
    const pending = tripAllCandidates(trip).filter(isHydrationPending);
    if (pending.length === 0) return null;

    const session: HydrateSession = {
        controller: new AbortController(),
        completion: Promise.resolve(),
        total: pending.length,
        onProgress: null,
        foreground: false,
    };
    sessions.set(tripIdx, session);
    state.hydratingTrips.add(tripIdx);
    session.completion = runHydrateData(tripIdx, pending, session).finally(() => {
        if (sessions.get(tripIdx) === session) sessions.delete(tripIdx);
        state.hydratingTrips.delete(tripIdx);
    });
    return session;
}

/**
 * Hydrates one trip's DATA (no render, no modal): reads each file's moov
 * (duration/codec/createdUtc/rotation/repair), re-finalizes frame timing, runs
 * the codec-decodability check, extracts embedded GPS, then rebuilds the trip in
 * place (finalizeTripFromFrames - NO regroup, NO startUtc re-derive, so the card
 * does not jump trips under the user). No-op when the trip has no pending
 * candidates. Same-trip re-entry joins the in-flight session. Used by the
 * background fill, where no user-facing progress UI is wanted.
 */
export async function hydrateTripData(tripIdx: number): Promise<void> {
    const session = ensureHydrateSession(tripIdx);
    if (!session) return;
    await session.completion;
}

// Escalate to the blocking progress modal once hydration outlasts a blink. The
// synchronous "opening" spinner on the card (markOpening in sidebar.ts) is the
// instant feedback for every click regardless of backend; the modal adds a
// progress count + Skip for genuinely slow loads (real SAF/OTG). Kept low so a
// moderately slow load surfaces the modal, but above a fast in-memory read so it
// does not flash on a quick hydrate.
const HYDRATE_MODAL_THRESHOLD_MS = 250;

/**
 * Hydrates a trip and updates the UI - the trip-open path awaits this before
 * playback. No-op (resolves immediately) on the eager path or an already-filled
 * trip, so it is safe to await unconditionally. On a slow backend it escalates
 * to the shared lazyGpsLoad modal (progress + Skip) past a short threshold;
 * Skip aborts this trip's read, playback proceeds with the provisional metadata,
 * and the background fill finishes the trip later.
 */
export async function hydrateTrip(tripIdx: number): Promise<void> {
    const session = ensureHydrateSession(tripIdx);
    if (!session) return;

    // Mark this a foreground open so the background pump pauses: the user is
    // waiting on the blocking modal, and a concurrent background hydration would
    // double the IO on the slow backend the lazy path exists for. Promotes an
    // existing (possibly background-started) session too, since ensureHydrateSession
    // shares one session per trip. Cleared in finally on every exit (B5).
    session.foreground = true;

    let modalShown = false;
    // Owner token of the modal this call shows. Two foreground hydrations (rapid
    // clicks on different trips, slow backend) share the singleton modal; the
    // token keeps a finishing call from closing / repainting the other's modal.
    let modalToken = 0;
    const timer = setTimeout(() => {
        modalShown = true;
        modalToken = showLazyGpsLoadModal(session.total, () => session.controller.abort(), "hydrate");
        session.onProgress = (done, total) => updateLazyGpsLoadModalProgress(done, total, modalToken);
    }, HYDRATE_MODAL_THRESHOLD_MS);
    try {
        await session.completion;
    } finally {
        session.foreground = false;
        clearTimeout(timer);
        if (modalShown) {
            session.onProgress = null;
            closeLazyGpsLoadModal(modalToken);
        }
    }

    // The opened card is repainted by playFrame's renderTrips (which also reveals
    // the player); here we only kick its thumbnail. ensureTripPreview is a single
    // extraction, NOT the single-flight schedule, so opening a trip early no
    // longer aborts the background preview run and leaves the thumbnail unloaded.
    const trip = state.trips[tripIdx];
    if (trip) void ensureTripPreview(trip, updateTripPreview);
}

async function runHydrateData(tripIdx: number, pending: VideoCandidate[], session: HydrateSession): Promise<void> {
    const signal = session.controller.signal;
    const t0 = performance.now();
    // Match index results back to candidates by File identity (the indexer echoes
    // the same File object); capture the key BEFORE hydrate replaces the repaired
    // file so moov bytes keep the original source/path/metadata identity.
    const byFile = new Map<File, VideoCandidate>(pending.map((c) => [c.file, c]));
    const moovByKey = new Map<string, Uint8Array>();

    // --- moov stage: duration/codec/createdUtc/rotation/repair ---
    try {
        await indexAllMp4Files(
            pending.map((c) => c.file),
            (done, total, file, idx, moovBytes, repair) => {
                session.onProgress?.(done, total);
                const cand = byFile.get(file);
                if (!cand) return;
                if (!idx) {
                    // Unreadable / non-MP4 / broken moov: TERMINAL. Mark it so the
                    // background pump stops re-selecting this trip (otherwise the
                    // whole drop never converges and the final regroup sweep never
                    // runs); keep the filename-only provisional values - there is
                    // nothing better. Surfaced as a "read failed" affordance.
                    cand.indexFailed = true;
                    log.warn("hydrate moov read failed", { file: cand.file.name, tripIdx });
                    return;
                }
                const key = vendorFileKey(cand);
                // Cache moov bytes only for files that will actually be extracted,
                // gated by the same helper the eager path uses: basename-sidecar /
                // already-has-records / hint=none files never dispatch, so pinning
                // their ~100KB-2MB moov buffers for the whole trip's hydration is
                // pure heap waste on a long single trip (#12).
                const plan = planEmbeddedGpsQueue(cand, cand.records.length > 0, moovBytes != null);
                if (plan.cacheMoov && moovBytes) moovByKey.set(key, moovBytes);
                // The cache entry re-applies the repair on restore (the on-disk
                // bytes stay broken forever) - record it for the write below.
                if (repair) registerCandidateRepair(fileIdentityOf(cand.file, cand.relativePath), repair);
                hydrateCandidateFromIndex(cand, idx, repair);
            },
            /* concurrency */ 4,
            signal,
            { withMoovBytes: true },
        );
    } catch (err) {
        // Skip/Cancel aborts the indexer request; the worker dispose rejects with
        // a plain Error named AbortError (not always a DOMException), so match by
        // name. Treat abort as a normal early return: hydrateTrip resolves and
        // playback proceeds with the provisional metadata - the documented Skip
        // contract, which the unguarded await used to break (A1).
        if (err instanceof Error && err.name === "AbortError") return;
        // A genuine moov-stage failure (not a user abort) must not reject
        // session.completion out through hydrateTrip into app.ts as an
        // unhandledrejection. Log and degrade to provisional metadata, matching
        // the GPS stage below.
        log.warn("hydrate moov stage failed", { tripIdx, err: err instanceof Error ? err.message : String(err) });
        return;
    }
    if (signal.aborted) return;

    // --- codec stage: canPlay for the now-known codecs ---
    await checkCanPlay(pending);
    if (signal.aborted) return;

    // --- GPS stage: embedded extraction for this trip's source-hinted files,
    // reusing the moov bytes just read (prebuiltMoovByPath) to skip a 2nd read ---
    // The ClassifiedFile is reconstructed from the candidate (role is always
    // "video" here, sidecar/log fields null) rather than looked up in a per-drop
    // side map - so a candidate carried over still-un-hydrated from a previous
    // drop is not silently skipped for embedded-GPS extraction.
    const gpsTargets: ClassifiedFile[] = [];
    for (const cand of pending) {
        const vf: VendorFile = cand;
        if (!shouldTryEmbeddedGps(vf, cand.records.length > 0)) continue;
        gpsTargets.push({ file: vf, role: "video", sidecarId: null, sidecarMp4: null, logExtractorId: null });
    }
    // A failed GPS extraction must keep its files out of the cache write below
    // - the empty records would freeze "no GPS" across sessions for a failure
    // a plain retry may not repeat. Both grains, same as the eager path: the
    // whole dispatch throwing, and a per-file extractor error inside a
    // fulfilled one.
    let gpsStageFailed = false;
    const gpsErrorNames = new Set<string>();
    if (gpsTargets.length > 0) {
        try {
            const result = await dispatchParseVideoEmbeddedGps(
                gpsTargets,
                () => {},
                /* concurrency */ 4,
                signal,
                "all",
                moovByKey,
            );
            // Zero records with hints still counts: a quality-gated parse
            // (sstar-ssmd phantom-track gate) contributes only the frame-0
            // clock anchor + extractor attribution, consumed by the
            // rederiveStartUtcForCandidates call below.
            if (result.records.length > 0 || result.videoStartUtcHintByFileKey.size > 0) {
                applyLazyResultToState(result, tripIdx);
            }
            // Accel only ever rides a winning claim (the dispatcher records it
            // for the file whose extractor won with records or a start-UTC
            // hint), so this loop always runs when there is anything to collect.
            // Kept separate from the guard above so the accel merge does not
            // silently inherit applyLazyResultToState's condition.
            for (const [fileKey, samples] of result.accelByFileKey) {
                lazyEmbeddedAccelByFileKey.set(fileKey, samples);
            }
            for (const err of result.errors) gpsErrorNames.add(err.file);
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            gpsStageFailed = true;
            log.warn("hydrate gps stage failed", { tripIdx, err: err instanceof Error ? err.message : String(err) });
        }
    }
    if (signal.aborted) return;

    // Anchor the trip on REAL data NOW, not at the eventual global sweep: pull the
    // just-merged embedded GPS onto the candidates, re-derive startUtc from the
    // real createdUtc/records (the filename-only provisional anchor is routinely
    // off by the camera TZ/clock for embedded-GPS cameras, which would desync the
    // marker/chart from the video until the sweep), merge accel, then re-time the
    // frames with the real durations + startUtc. No regroup - boundary
    // reconciliation stays deferred to the final sweep.
    const trip = state.trips[tripIdx];
    if (trip) {
        const cands = tripAllCandidates(trip);
        if (state.gpsLog) {
            const loaded = state.trips.flatMap(tripAllCandidates);
            attachRecordsToCandidates(state.gpsLog, cands, loaded);
        }
        rederiveStartUtcForCandidates(cands, classifyFilenameTime);
        mergeLazyAccel(cands);
        for (const frame of trip.frames) finalizeFrameTiming(frame);
    }

    // Rebuild the trip in place (records/distance/events/timeline). refreshTrip
    // pulls records from gpsLog, carries the preview, and redraws chart/map if
    // this trip is active. Does NOT regroup or re-render the list.
    refreshTrip(tripIdx);

    // Markers placed on this trip's provisional timeline (a Skip lands there)
    // carry a wrong absolute UTC - move them onto the now-real one before it
    // flows any further (the notes file flushes on every marker save).
    restampProvisionalMarkers();

    // Persist this trip's hydration for the next session - the lazy path used
    // to never write the cache, so slow backends (the ones the path exists
    // for) re-read every moov and re-extracted every track each session.
    // Only candidates that actually hydrated (a failed moov read keeps
    // hydrated=false); a crashed GPS stage keeps its targets out entirely.
    // startUtc may still shift at the final sweep - harmless, a restore
    // re-derives it from the cached createdUtc/records anyway.
    const hydratedNow = pending.filter((cand) => cand.hydrated === true);
    const gpsTargetKeys = new Set(gpsTargets.map((cf) => vendorFileKey(cf.file)));
    const skipKeys = new Set<string>();
    for (const cand of hydratedNow) {
        const key = vendorFileKey(cand);
        if (!gpsTargetKeys.has(key)) continue;
        // A whole-dispatch failure took every target down with it. A per-file
        // error also needs the empty result: the errors carry a basename, and
        // another extractor may have claimed the file after the one that threw.
        if (gpsStageFailed || (cand.records.length === 0 && gpsErrorNames.has(cand.file.name))) skipKeys.add(key);
    }
    scheduleIndexCacheWrite(hydratedNow, skipKeys);

    log.info("trip hydrated", { tripIdx, files: pending.length, durationMs: Math.round(performance.now() - t0) });
}

/**
 * Merges this drop's accel-only sidecar (.3gf) samples into the given
 * candidates' GpsRecords in place, keyed by absolute time. Must run AFTER the
 * startUtc re-derive (the sample time = startUtc + msSinceStart). Scoped to the
 * candidates' own records so it stays O(trip) per call. No-op when the drop has
 * no accel sidecar or no GpsLog to attach to.
 *
 * Safe to call twice (per-trip during the fill, then globally in finish() once
 * startUtc is authoritative): mergeAccelSamples assigns absolutely (record.accel
 * = sample - bias), not additively, so a re-merge just re-places to the best
 * match. A sub-0.5s startUtc shift between the two passes could in theory leave a
 * synced record with a stale match, but that needs the no-mvhd filename-anchored
 * branch (startUtc varies with the candidate set) on a camera that ALSO ships a
 * .3gf sidecar - BlackVue (the only .3gf source) writes mvhd, so its anchor is
 * pass-invariant and the case does not arise on a real camera.
 */
function mergeLazyAccel(cands: readonly VideoCandidate[]): void {
    const accelByFileKey = combineAccelSources(lazyAccelByFileKey ?? new Map(), lazyEmbeddedAccelByFileKey);
    if (accelByFileKey.size === 0 || !state.gpsLog) return;
    const startUtcByFileKey = new Map<string, number>();
    const tripRecords: GpsRecord[] = [];
    for (const cand of cands) {
        startUtcByFileKey.set(vendorFileKey(cand), cand.startUtc);
        // candidate.records are the SAME GpsRecord objects state.gpsLog holds, so
        // mutating them here is what the chart/map later read.
        for (const rec of cand.records) tripRecords.push(rec);
    }
    mergeAccelSamples(tripRecords, accelByFileKey, startUtcByFileKey);
}

// === Low-priority background fill ===

// Bumped on each ingest / cancel; a pump from an older generation stops.
let fillGeneration = 0;

function scheduleIdle(fn: () => void): void {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 2000 });
    else setTimeout(fn, 200);
}

/**
 * Hydrates un-opened trips one at a time at idle, in the order the user
 * currently SEES the list (so the cards at the top of the viewport fill first -
 * see pickFillIndex), yielding between each so it never blocks interaction. When
 * every trip is hydrated, runs ONE global regroup sweep (recomputeAllStartUtc) to
 * reconcile trip boundaries with the now-real durations and re-derive startUtc
 * from real mvhd/GPS.
 */
function startBackgroundFill(): void {
    const generation = ++fillGeneration;
    let ticks = 0;
    // Safety cap: each trip gets several attempts (a foreground Skip can return a
    // trip to pending for a retry) before we give up and regroup anyway. The
    // indexFailed terminal flag already guarantees convergence; this only catches
    // an unexpected stuck state so the sweep cannot be starved forever.
    const maxTicks = Math.max(8, state.trips.length * 4);
    // Same backstop for the "defer the sweep while a foreground session is in
    // flight" branch below: a session always settles in practice (every stage is
    // abort-guarded and the worker resolves), but bound the deferral so a wedged
    // worker cannot starve the final sweep forever. Idle-scheduled, so this is
    // many minutes of real time - far beyond any genuine foreground hydrate.
    let deferTicks = 0;
    const maxDeferTicks = 1000;

    // Next trip to fill: the first still-pending, session-free trip in the order
    // the sidebar currently DISPLAYS, so the cards the user is looking at hydrate
    // first - not blindly state.trips[0] (which groupTrips sorts oldest-first,
    // the BOTTOM of the default date/desc view). Mirrors renderTrips' order:
    //  - sort by date: follow tripSortDir (desc default = newest first);
    //  - sort by duration/distance: the sidebar parks provisional trips ascending
    //    by startUtc regardless of direction, so oldest-first matches the display.
    // Reads state.tripSortKey/Dir live, so changing the sort mid-fill re-targets.
    const pickFillIndex = (): number => {
        const newestFirst = state.tripSortKey === "date" && state.tripSortDir === "desc";
        let best = -1;
        let bestStart = 0;
        for (let i = 0; i < state.trips.length; i++) {
            if (sessions.has(i)) continue;
            const trip = state.trips[i]!;
            if (!tripAllCandidates(trip).some(isHydrationPending)) continue;
            if (best < 0 || (newestFirst ? trip.startUtc > bestStart : trip.startUtc < bestStart)) {
                best = i;
                bestStart = trip.startUtc;
            }
        }
        return best;
    };

    const finish = (): void => {
        if (generation !== fillGeneration || !lazyAllCandidates) return;
        if (recomputeSweep) {
            // One final regroup with real durations/startUtc - re-derives the
            // boundaries and renders the final, stable list.
            recomputeSweep(lazyAllCandidates);
            // Re-merge accel with the now-authoritative startUtc (per-trip merges
            // during the fill used each trip's pre-sweep anchor). Then refresh the
            // active trip so its chart/map pick up the re-placed G-load.
            mergeLazyAccel(lazyAllCandidates);
            if (state.active) refreshTrip(state.active.trip);
            // The sweep can shift startUtc once more (boundaries reconcile
            // with real durations) - give every anchored marker its final
            // position, then release the anchors: nothing moves them after this.
            restampProvisionalMarkers({ final: true });
            log.info("lazy background fill complete, regrouped", { trips: state.trips.length });
        } else {
            log.warn("recompute sweep not registered, skipping final regroup");
        }
        // Authoritative preview pass over the now-stable trip objects: fills any
        // trip still missing a thumbnail and recovers previews whose extraction
        // landed on a trip object orphaned by the regroup.
        void schedulePopulateTripPreviews(state.trips, updateTripPreview);
    };

    const pump = (): void => {
        if (generation !== fillGeneration) return; // superseded
        // Pause the background fill while the user waits on a foreground
        // hydration (blocking modal): two sessions x concurrency 4 = up to 8
        // concurrent 16MB header reads contending for the slow SD-over-OTG
        // backend the lazy path exists for. Reuse the same bounded deferTicks
        // fuse as the sweep-defer below so a wedged foreground session cannot
        // starve finish() forever (B5).
        if (anyForegroundSession() && deferTicks++ < maxDeferTicks) {
            scheduleIdle(pump);
            return;
        }
        const idx = pickFillIndex();
        if (idx < 0) {
            // Nothing schedulable. A still-in-flight FOREGROUND session (the user
            // opened a trip) keeps its trip out of findIndex while it hydrates. We
            // must NOT finish() yet: the final regroup would run on that trip's
            // provisional duration, and the in-flight session would later write to
            // a post-regroup stale index. Defer the sweep until every session has
            // drained (also lets a Skip return a trip to pending for a retry),
            // bounded by maxDeferTicks so a wedged session cannot starve finish().
            if (sessions.size > 0 && deferTicks++ < maxDeferTicks) {
                scheduleIdle(pump);
                return;
            }
            finish();
            return;
        }
        if (ticks++ > maxTicks) {
            log.warn("lazy background fill hit tick cap, forcing regroup", { ticks, trips: state.trips.length });
            finish();
            return;
        }
        void hydrateTripData(idx)
            .then(() => {
                if (generation !== fillGeneration) return;
                // Targeted: update just this card (meta now real) + kick its
                // thumbnail, instead of a full renderTrips per trip = list flicker.
                refreshTripCard(idx);
                const trip = state.trips[idx];
                if (trip) void ensureTripPreview(trip, updateTripPreview);
            })
            .catch((err) => {
                log.debug("background hydrate failed", { idx, err: err instanceof Error ? err.message : String(err) });
            })
            .finally(() => {
                if (generation === fillGeneration) scheduleIdle(pump);
            });
    };
    scheduleIdle(pump);
}

// === Finish (compact analogue of the eager ingest tail) ===

function finishLazyIngest(ctx: LazyHydrationContext): void {
    log.info("ingest done (filename-first)", {
        durationMs: Math.round(performance.now() - ctx.ingestStart),
        tripsCount: state.trips.length,
        videosTotal: ctx.allCandidates.length,
        videosNew: ctx.newVideos.length,
    });

    // Onboarding tour + install toast: same peak-value moment as the eager path
    // (the user has just seen their trips).
    if (state.trips.length > 0) {
        maybeRunIngestTour();
        void maybeShowPostIngestToast();
    }

    emitLifecycle("ingest-done", {
        tripsCount: state.trips.length,
        videosTotal: ctx.allCandidates.length,
        gpsRecordsTotal: state.gpsLog?.records.length ?? 0,
        durationMs: Math.round(performance.now() - ctx.ingestStart),
    });
}

// Lazy loading of heavy embedded-GPS on trip-click. An alternative to the bulk
// ingest stage when the user declined the prompt.
//
// Scenario: ingest finished, user chose "Later, on click" in the prompt modal.
// Heavy files settled in state.pendingHeavyEmbeddedGps. On trip click
// awaitLazyEmbeddedGpsForTrip parses its heavy files in the background BLOCKING
// playFrame start: a load modal with progress and Cancel is shown; on completion
// the modal closes and playFrame starts. If the trip has no pending files the
// function resolves immediately with no modal.
//
// Cancel: AbortController aborts the dispatch. Files are returned to pending
// (user can retry later). The promise still resolves - playFrame starts anyway,
// video plays without a track or distance.
//
// Trip boundaries are NOT regrouped (recomputeAllStartUtc + groupTrips would do
// that, but the active trip in the player could shift to a different index under
// the playing user). Limited to recomputing trip.records / distanceKm / events
// in-place via finalizeTripFromFrames over the same frames.

import { mergeIntoGpsLog } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry.js";
import { createLogger } from "../log.js";
import { finalizeTripFromFrames, tripAllCandidates } from "../trips.js";

import { dispatchParseVideoEmbeddedGpsViaWorker as dispatchParseVideoEmbeddedGps } from "./gps-extract-shim.js";
import { scheduleIndexCacheWrite } from "./ingest-cache.js";
import { vendorFileKey } from "./ingest-candidate.js";
import { closeLazyGpsLoadModal, showLazyGpsLoadModal, updateLazyGpsLoadModalProgress } from "./lazy-gps-load-modal.js";
import { rebuildChartFromTrip } from "./chart.js";
import { refreshMap } from "./map.js";
import { renderTrips } from "./sidebar.js";
import { state } from "./state.js";
import { carryBlurRegions } from "./blur-regions-state.js";
import { carryOverTripPreviews } from "./trip-preview.js";

const log = createLogger("lazy-embedded");

// Monotonic trip-open counter. The token is minted ONCE at the top of a
// trip-open chain (takeTripOpenToken, before the awaited hydrateTrip), then
// read - not re-minted - inside awaitLazyEmbeddedGpsForTrip. A later click mints
// a newer token, so an older chain sees its token is no longer current and bails
// instead of yanking the player to a trip the user already navigated away from.
// Minting at the top (not inside awaitLazyEmbeddedGpsForTrip) closes the hydrateTrip
// window: a slow hydration of trip A could otherwise finish after the user opened
// trip B and start playback of A on top of B.
let lazyClickSeq = 0;

/**
 * Mints a fresh trip-open token and returns it. Call once at the TOP of a
 * trip-open chain, before the awaited hydrateTrip. Pair with isCurrentTripOpen
 * after each await to detect that a later click superseded this chain.
 */
export function takeTripOpenToken(): number {
    return ++lazyClickSeq;
}

/** Whether `token` is still the most recent trip-open click (not superseded). */
export function isCurrentTripOpen(token: number): boolean {
    return token === lazyClickSeq;
}

/**
 * Starts (or joins) a blocking heavy-embedded-GPS load for all trip files in
 * state.pendingHeavyEmbeddedGps. Resolves:
 *  - immediately if the trip has no pending files (player starts without delay);
 *  - after parsing completes and the Trip is updated;
 *  - after user Cancel in the modal (files that were already parsed are merged,
 *    the rest are returned to pending for a retry).
 *
 * Returns whether the caller should PROCEED with playback: false when a newer
 * trip click superseded this one while the load ran.
 *
 * Re-click semantics: a click on the SAME trip while its load runs JOINS the
 * in-flight session (one modal, one load); a click on a DIFFERENT trip aborts
 * the old session (its files return to pending for a retry) and starts fresh.
 */
export async function awaitLazyEmbeddedGpsForTrip(tripIdx: number): Promise<boolean> {
    // Read (do NOT mint) the current trip-open token: the caller minted it at the
    // top of the chain via takeTripOpenToken, so a click that superseded this
    // chain during the awaited hydrateTrip has already bumped lazyClickSeq and the
    // checks below return proceed=false.
    const mySeq = lazyClickSeq;
    const trip = state.trips[tripIdx];
    if (!trip) return false;

    // A session left over from a DIFFERENT trip is obsolete - abort it (its
    // finally returns unparsed files to pending and closes the modal).
    // Without this, the new trip started playing behind the old modal.
    if (currentLazySession && currentLazySession.tripIdx !== tripIdx) {
        currentLazySession.controller.abort();
    }
    // Same-trip re-click: join the in-flight session (one modal, one load). Resolving
    // immediately when targets is empty would start playback behind the blocking
    // modal and let the first click's handler restart the trip on completion.
    if (currentLazySession && currentLazySession.tripIdx === tripIdx) {
        await currentLazySession.completion;
        return lazyClickSeq === mySeq;
    }

    if (state.pendingHeavyEmbeddedGps.size === 0) return lazyClickSeq === mySeq;

    const targets: ClassifiedFile[] = [];
    for (const cand of tripAllCandidates(trip)) {
        // vendorFileKey (path-qualified), not basename: a candidate is a VendorFile
        // structurally, and the deferred map was set under the same key at ingest.
        const key = vendorFileKey(cand);
        const cf = state.pendingHeavyEmbeddedGps.get(key);
        if (!cf) continue;
        targets.push(cf);
        state.pendingHeavyEmbeddedGps.delete(key);
        state.inflightHeavyEmbeddedGps.add(key);
    }
    if (targets.length === 0) return lazyClickSeq === mySeq;

    const controller = new AbortController();
    const session: LazySession = { controller, tripIdx, completion: Promise.resolve() };
    currentLazySession = session;
    session.completion = runLazyLoad(session, targets, tripIdx);
    await session.completion;
    return lazyClickSeq === mySeq;
}

/** The actual load body - tracked as session.completion so same-trip
 *  re-clicks can join instead of racing a second load. */
async function runLazyLoad(session: LazySession, targets: ClassifiedFile[], tripIdx: number): Promise<void> {
    const controller = session.controller;

    renderTrips(); // pending → inflight (skeleton → spinner)

    const cancelHandler = () => controller.abort();
    const modalToken = showLazyGpsLoadModal(targets.length, cancelHandler);

    const t0 = performance.now();
    let result: Awaited<ReturnType<typeof dispatchParseVideoEmbeddedGps>> | null = null;
    let aborted = false;
    let failed = false;
    try {
        result = await dispatchParseVideoEmbeddedGps(
            targets,
            (done, total) => updateLazyGpsLoadModalProgress(done, total, modalToken),
            /* concurrency */ 4,
            controller.signal,
            "all",
        );
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            aborted = true;
            log.info("lazy embedded gps cancelled by user", { tripIdx, files: targets.length });
        } else {
            // Non-abort failure: result stays null, so the return-to-pending
            // branch below puts every target back (winning is empty). Without
            // this the files are gone from BOTH pending and inflight - lost
            // until a full re-ingest, with nothing shown to the user.
            failed = true;
            log.error("lazy embedded gps failed", err);
        }
    } finally {
        // If the session changed (user clicked another trip), do not touch the
        // modal or inflight for OUR files; the new session is already running.
        // But for files belonging to this session: clear inflight, and if
        // cancelled return them to pending.
        for (const cf of targets) {
            state.inflightHeavyEmbeddedGps.delete(vendorFileKey(cf.file));
        }
        if (aborted || failed) {
            // Return not-yet-parsed files to pending so the user can retry.
            // Covers both cancel and non-abort failure. Already parsed files (a
            // partial batch before abort) stay in state.gpsLog below; we do not
            // return them to pending (winningExtractorByFilename = the success
            // set). On a non-abort failure result is null, so every target
            // returns to pending.
            // winningExtractorByFilename is keyed by basename (GpsRecord.mp4Filename)
            // - the parser contract - so the "already parsed?" check reads basename;
            // the pending map is re-keyed by vendorFileKey (path-qualified).
            const winning = result?.winningExtractorByFilename ?? new Map<string, string>();
            for (const cf of targets) {
                if (!winning.has(cf.file.file.name)) {
                    state.pendingHeavyEmbeddedGps.set(vendorFileKey(cf.file), cf);
                }
            }
        }
        if (currentLazySession === session) {
            currentLazySession = null;
            closeLazyGpsLoadModal(modalToken);
        }
    }

    if (result && result.records.length > 0) {
        log.info("lazy embedded gps done", {
            tripIdx,
            files: targets.length,
            recordsAdded: result.records.length,
            durationMs: Math.round(performance.now() - t0),
        });
        applyLazyResultToState(result, tripIdx);
        // No vendorId in this architecture, so no VideoCandidate "upgrade"
        // after embedded GPS: channel/sequence/mode come from filename
        // classifiers, and the fingerprint is stable regardless of which
        // extractor produced the records.
    }

    refreshTrip(tripIdx);

    // Persist the scan for the next session: these files were excluded from
    // the ingest-tail cache write exactly because their records were not
    // extracted yet - without this write the full-file scan (and its modal)
    // repeats every session forever. After refreshTrip, which is what puts
    // the fresh records onto the candidates the entry snapshots. A scan that
    // honestly found nothing is cached too - "no GPS" re-verified by a full
    // read is knowledge, not a transient. Files returned to pending (partial
    // cancel / failure) are still excluded via the skip set.
    if (result) {
        const targetKeys = new Set(targets.map((cf) => vendorFileKey(cf.file)));
        const trip = state.trips[tripIdx];
        const scanned = trip ? tripAllCandidates(trip).filter((cand) => targetKeys.has(vendorFileKey(cand))) : [];
        scheduleIndexCacheWrite(scanned, new Set(state.pendingHeavyEmbeddedGps.keys()));
    }

    if (result && result.errors.length > 0) {
        log.warn("lazy embedded gps errors", { tripIdx, errors: result.errors });
    }

    renderTrips();
}

interface LazySession {
    controller: AbortController;
    tripIdx: number;
    /** Settles when the load body (runLazyLoad) finishes - join point for
     *  same-trip re-clicks. */
    completion: Promise<void>;
}

/** Active lazy-loading session (one per app). */
let currentLazySession: LazySession | null = null;

/**
 * Merges a lazy embedded-GPS result into state. Mirrors the bulk path in
 * ingest.ts applyEmbeddedResultToState:
 *  - unions appliedExtractors into state.gpsLog so the diagnostics list
 *    reflects extractors that only contributed via the lazy path;
 *  - pushes winning extractor ids onto each affected candidate's
 *    appliedExtractors so per-file attribution stays in sync.
 *
 * Trip-scoped: only candidates of the active trip are touched. Heavy-pending
 * files belong to exactly one trip (set in ingest.ts), so this is sufficient.
 */
export function applyLazyResultToState(
    result: Awaited<ReturnType<typeof dispatchParseVideoEmbeddedGps>>,
    tripIdx: number,
): void {
    state.gpsLog = mergeIntoGpsLog(state.gpsLog, result);
    const trip = state.trips[tripIdx];
    if (!trip) return;
    for (const cand of tripAllCandidates(trip)) {
        const winning = result.winningExtractorByFilename.get(cand.file.name);
        if (winning && !cand.appliedExtractors.includes(winning)) {
            cand.appliedExtractors.push(winning);
        }
        // Frame-0 wall-clock anchor, same contract as the bulk path. On the
        // hydrate path rederiveStartUtcForCandidates runs right after and
        // consumes it; on the heavy trip-click path it takes effect on the
        // next regroup (refreshTrip deliberately keeps trip boundaries).
        const hint = result.videoStartUtcHintByFilename.get(cand.file.name);
        if (hint !== undefined) cand.embeddedStartUtcHint = hint;
        // Local-as-UTC clock evidence, deferred the same way - and it must
        // stay deferred: applyLocalClockCorrections moves records only, so
        // firing it without re-anchoring the frames would drag the track off
        // the trip window by a whole zone. Until the next regroup the trip is
        // self-consistent on the camera's local clock (anchor and records both
        // carry the zone) and renders in the viewer's zone like any trip with
        // no zone estimate.
        const clockHint = result.localClockOffsetHintByFilename.get(cand.file.name);
        if (clockHint !== undefined) cand.localClockOffsetHintSec = clockHint;
    }
}

/**
 * Recomputes state.trips[tripIdx] from the updated state.gpsLog. Iterates
 * over candidates, assigns new records from byFilename, calls finalizeTrip
 * with the same frames - yields a new Trip with recomputed records/distanceKm/
 * events. startUtc/endUtc/durationSec are unchanged (taken from first/last
 * frame.startUtc, which we do not modify to avoid shifting trip boundaries).
 *
 * If the trip is active, redraws the chart and map (Trip data alone is not
 * enough - these modules cache their own datasets/sources).
 */
export function refreshTrip(tripIdx: number): void {
    const old = state.trips[tripIdx];
    if (!old) return;
    if (state.gpsLog) {
        for (const cand of tripAllCandidates(old)) {
            const recs = state.gpsLog.byFilename.get(cand.file.name);
            if (recs && recs.length > 0) cand.records = recs;
        }
    }
    const refreshed = finalizeTripFromFrames(old.frames);
    // Carry the preview to the freshly built Trip - finalizeTripFromFrames
    // does not see the old object. Without this, the user's lazy-GPS click
    // wipes the preview from the trip card (no schedulePopulateTripPreviews
    // runs on this path, so it would never come back until the next ingest).
    carryOverTripPreviews([old], [refreshed]);
    state.trips[tripIdx] = refreshed;
    // Same frames -> same content timeline: blur-region keyframes stay valid.
    // After the slot swap so the carry's notify reads the new trip.
    carryBlurRegions([old], [refreshed]);

    if (state.active && state.active.trip === tripIdx) {
        rebuildChartFromTrip(refreshed);
        refreshMap(refreshed);
    }
}

import { attachRecordsToCandidates } from "../gps-association.js";
import { applyStoredGpsSyncToTrip } from "../gps-sync.js";
import { classifyFilenameTime } from "../parsers/filename/index.js";
import {
    finalizeTripFromFrames,
    rederiveStartUtcForCandidates,
    tripAllCandidates,
    type VideoCandidate,
} from "../trips.js";

import { applyRegroup } from "./apply-regroup.js";
import { carryBlurRegions } from "./blur-regions-state.js";
import { rebuildChartFromTrip } from "./chart.js";
import { refreshMap } from "./map.js";
import { state } from "./state.js";
import { carryOverTripPreviews } from "./trip-preview.js";

interface RecordingWorkCoordinator {
    pauseForRegroup: () => boolean;
    resumeAfterRegroup: () => void;
}

let workCoordinator: RecordingWorkCoordinator | null = null;

/** Connects the progressive scheduler without importing it back into this
 * commit-boundary module (which would create a dependency cycle). */
export function registerRecordingWorkCoordinator(coordinator: RecordingWorkCoordinator): void {
    workCoordinator = coordinator;
}

/** Recomputes absolute recording clocks without replacing the current trip list. */
export function reanchorRecordingCandidates(candidates: VideoCandidate[]): void {
    rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
}

/** Groups already-anchored candidates and atomically replaces the trip list. */
export function commitRecordingTrips(candidates: VideoCandidate[]): void {
    applyRegroup(candidates);
}

/** External metadata/settings changes use this boundary so index-keyed reads
 * cannot write through a regroup. The scheduler resumes from live trip objects. */
export function commitRecordingTripsWhilePreservingIngest(candidates: VideoCandidate[]): void {
    const coordinator = workCoordinator;
    const paused = coordinator?.pauseForRegroup() ?? false;
    try {
        commitRecordingTrips(candidates);
    } finally {
        if (paused) coordinator?.resumeAfterRegroup();
    }
}

/** Rebuilds one trip's aggregates without changing its membership or index. */
export function refreshRecordingTrip(tripIdx: number): void {
    const old = state.trips[tripIdx];
    if (!old) return;
    if (state.gpsLog) {
        const loaded = state.trips.flatMap(tripAllCandidates);
        attachRecordsToCandidates(state.gpsLog, tripAllCandidates(old), loaded);
    }
    const refreshed = finalizeTripFromFrames(old.frames);
    applyStoredGpsSyncToTrip(refreshed);
    carryOverTripPreviews([old], [refreshed]);
    state.trips[tripIdx] = refreshed;
    // Same frames mean the same content timeline; blur keyframes remain valid.
    // Notify only after the slot swap so listeners read the new trip.
    carryBlurRegions([old], [refreshed]);

    if (state.active?.trip === tripIdx) {
        rebuildChartFromTrip(refreshed);
        refreshMap(refreshed);
    }
}

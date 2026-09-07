import { attachRecordsToCandidates, type VideoAssociationIndex } from "../gps-association.js";
import { mergeIntoGpsLog } from "../parser.js";
import type { ClassifiedFile, DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import type { VideoCandidate } from "../trips.js";

import { vendorFileKey } from "./ingest-candidate.js";
import { state } from "./state.js";

/** A retry replaces its old failure only after the attempt has completed. */
export function applyEmbeddedGpsFailures(
    result: DispatchedEmbeddedGpsResult,
    targets: readonly ClassifiedFile[],
): void {
    const deferred = new Set(result.heavyFiles.map((target) => vendorFileKey(target.file)));
    for (const target of targets) {
        const key = vendorFileKey(target.file);
        if (deferred.has(key)) continue;
        if (result.failedFileKeys.has(key)) state.failedEmbeddedGps.add(key);
        else state.failedEmbeddedGps.delete(key);
    }
}

/** Merges an extraction result and applies its file-level attribution and clock evidence. */
export function applyEmbeddedGpsResult(
    result: DispatchedEmbeddedGpsResult,
    candidates: readonly VideoCandidate[],
    associationCandidates: readonly VideoCandidate[] | VideoAssociationIndex,
): void {
    state.gpsLog = mergeIntoGpsLog(state.gpsLog, result);
    attachRecordsToCandidates(state.gpsLog, candidates, associationCandidates);
    for (const candidate of candidates) {
        const key = vendorFileKey(candidate);
        const extractor = result.winningExtractorByFileKey.get(key);
        if (extractor && !candidate.appliedExtractors.includes(extractor)) {
            candidate.appliedExtractors.push(extractor);
        }
        const startHint = result.videoStartUtcHintByFileKey.get(key);
        if (startHint !== undefined) candidate.embeddedStartUtcHint = startHint;
        const clockHint = result.localClockOffsetHintByFileKey.get(key);
        if (clockHint !== undefined) candidate.localClockOffsetHintSec = clockHint;
    }
}

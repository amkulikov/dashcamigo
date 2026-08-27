// Trip-level planning for user-supplied GPX files which survived every
// classifier and basename-sidecar rule. Timestamp overlap is recommendation
// evidence only; the modal still requires the user to confirm every mapping.

import { recordsHaveGps } from "../parser.js";
import type { GpxTimeRange } from "../parsers/sidecars/gpx.js";
import type { GpsRecord, VendorFile } from "../parsers/types.js";
import { pickFrameChannel, tripAllCandidates, type Trip } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";
import { formatTripTitle } from "./format.js";
import type { LooseGpxChoice, LooseGpxPlan, LooseGpxTarget, ParsedLooseGpx } from "./loose-gpx.js";

function vendorFileForTripAnchor(trip: Trip): VendorFile | null {
    const first = trip.frames[0];
    const picked = first ? pickFrameChannel(first, "front") : null;
    if (!picked) return null;
    return {
        file: picked.candidate.file,
        relativePath: picked.candidate.relativePath,
        sourceKey: picked.candidate.sourceKey,
    };
}

function tripFootageRanges(trip: Trip): GpxTimeRange[] {
    return trip.timeline.segments.map((segment) => ({
        startUnix: segment.wallStart,
        endUnix: segment.wallStart + segment.wallDurationSec,
    }));
}

/** One destination per derived trip, never one per clip/channel. Native logs,
 *  exact sidecars and known pending embedded streams protect the whole trip. */
export function looseGpxTargets(
    trips: readonly Trip[],
    protectedGpsVideoKeys: ReadonlySet<string> = new Set(),
): LooseGpxTarget[] {
    const targets: LooseGpxTarget[] = [];
    for (const trip of trips) {
        const anchor = vendorFileForTripAnchor(trip);
        if (!anchor) continue;
        const candidates = tripAllCandidates(trip);
        targets.push({
            mp4Filename: anchor.file.name,
            videoKey: vendorFileKey(anchor),
            label: formatTripTitle(trip),
            hasGps:
                candidates.some((candidate) => recordsHaveGps(candidate.records)) ||
                candidates.some((candidate) => protectedGpsVideoKeys.has(vendorFileKey(candidate))),
            // Filesystem mtime is explicitly a fallback, not recording-clock
            // evidence. One uncertain clip makes the provisional trip unsafe
            // for an automatic recommendation.
            timeReliable: candidates.every((candidate) => candidate.startSource !== "mtime"),
            footageRanges: tripFootageRanges(trip),
        });
    }
    return targets;
}

function overlapSeconds(a: readonly GpxTimeRange[], b: readonly GpxTimeRange[]): number {
    let total = 0;
    for (const left of a) {
        for (const right of b) {
            const start = Math.max(left.startUnix, right.startUnix);
            const end = Math.min(left.endUnix, right.endUnix);
            // Inclusive overlap makes a one-point GPX at a valid video instant
            // a match even though its mathematical duration is zero.
            if (end >= start) total += Math.max(0.001, end - start);
        }
    }
    return total;
}

function choiceFor(track: ParsedLooseGpx, target: LooseGpxTarget): LooseGpxChoice {
    if (!track.hasExplicitTimezone || !target.timeReliable) {
        return { target, timeMatch: "uncertain", overlapSec: 0 };
    }
    const overlapSec = overlapSeconds(track.timeRanges, target.footageRanges);
    return { target, timeMatch: overlapSec > 0 ? "overlap" : "none", overlapSec };
}

function choiceRank(choice: LooseGpxChoice): number {
    if (choice.target.hasGps) return 3;
    if (choice.timeMatch === "overlap") return 0;
    if (choice.timeMatch === "uncertain") return 1;
    return 2;
}

/** Builds per-track choices and conservative one-to-one recommendations. A
 *  pair is preselected only when it is the track's sole reliable overlap and
 *  no other track also overlaps that destination. */
export function planLooseGpxAssignments(
    tracks: readonly ParsedLooseGpx[],
    targets: readonly LooseGpxTarget[],
): LooseGpxPlan[] {
    const plans: LooseGpxPlan[] = tracks.map((track) => {
        const choices = targets.map((target) => choiceFor(track, target));
        choices.sort((a, b) => choiceRank(a) - choiceRank(b) || b.overlapSec - a.overlapSec);
        return { track, choices, recommendedVideoKey: null };
    });

    const overlapOwners = new Map<string, number>();
    for (const plan of plans) {
        for (const choice of plan.choices) {
            if (choice.target.hasGps || choice.timeMatch !== "overlap") continue;
            overlapOwners.set(choice.target.videoKey, (overlapOwners.get(choice.target.videoKey) ?? 0) + 1);
        }
    }
    for (const plan of plans) {
        const matches = plan.choices.filter((choice) => !choice.target.hasGps && choice.timeMatch === "overlap");
        if (matches.length !== 1) continue;
        const key = matches[0]!.target.videoKey;
        if (overlapOwners.get(key) === 1) plan.recommendedVideoKey = key;
    }
    return plans;
}

export interface LooseGpxAssignment {
    track: ParsedLooseGpx;
    target: LooseGpxTarget;
}

/** Converts confirmed mappings to GPS records. Clones keep the parsed source
 *  immutable and stamp the exact trip anchor plus source-specific sync key. */
export function recordsForLooseGpxAssignments(assignments: readonly LooseGpxAssignment[]): GpsRecord[] {
    const records: GpsRecord[] = [];
    const usedTargets = new Set<string>();
    for (const { track, target } of assignments) {
        if (target.hasGps || usedTargets.has(target.videoKey)) continue;
        usedTargets.add(target.videoKey);
        for (const record of track.records) {
            records.push({
                ...record,
                mp4Filename: target.mp4Filename,
                videoKey: target.videoKey,
                externalTrack: true,
                externalTrackKey: track.trackKey,
            });
        }
    }
    return records;
}

// The uncommon many-GPX/manual-target path. Kept separate from loose-gpx.ts so
// ordinary folder loads do not pay for assignment planning in the entry chunk.

import { recordsHaveGps } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { VendorFile } from "../parsers/types.js";
import { pickFrameChannel, type Trip } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";
import type { LooseGpxPairResult, LooseGpxTarget } from "./loose-gpx.js";

function targetForVendorFile(file: VendorFile, hasGps = false): LooseGpxTarget {
    return {
        mp4Filename: file.file.name,
        videoKey: vendorFileKey(file),
        label: file.relativePath || file.file.name,
        hasGps,
    };
}

/** Manual destinations for an ambiguous GPX batch. A batch that also carries
 *  videos targets those new files; a later GPX-only batch targets the open
 *  trip, or every loaded trip when none is open. Already grouped trips expose
 *  one logical clip per frame, never one option per camera. */
export function looseGpxTargets(
    newVideos: readonly ClassifiedFile[],
    loadedTrips: readonly Trip[],
    activeTripIndex: number | null,
): LooseGpxTarget[] {
    if (newVideos.length > 0) return newVideos.map((video) => targetForVendorFile(video.file));

    const activeTrip = activeTripIndex === null ? null : (loadedTrips[activeTripIndex] ?? null);
    const trips = activeTrip ? [activeTrip] : loadedTrips;
    const targets: LooseGpxTarget[] = [];
    for (const trip of trips) {
        for (const frame of trip.frames) {
            const picked = pickFrameChannel(frame, "front");
            if (!picked) continue;
            const candidate = picked.candidate;
            const frameHasGps = Object.values(frame.channels).some((sibling) => recordsHaveGps(sibling?.records));
            targets.push(
                targetForVendorFile(
                    {
                        file: candidate.file,
                        relativePath: candidate.relativePath,
                        sourceKey: candidate.sourceKey,
                    },
                    frameHasGps,
                ),
            );
        }
    }
    return targets;
}

export interface LooseGpxAssignment {
    file: ClassifiedFile;
    target: LooseGpxTarget;
}

/** Applies the explicit rows returned by the assignment dialog. Object identity
 *  ties each choice to the exact classified entry without reducing two
 *  same-named GPX files from different folders to one basename. */
export function pairAssignedLooseGpxFiles(
    classified: ClassifiedFile[],
    assignments: readonly LooseGpxAssignment[],
): LooseGpxPairResult {
    const targetByFile = new Map<ClassifiedFile, LooseGpxTarget>();
    const usedVideoKeys = new Set<string>();
    for (const { file, target } of assignments) {
        if (target.hasGps || usedVideoKeys.has(target.videoKey)) continue;
        targetByFile.set(file, target);
        usedVideoKeys.add(target.videoKey);
    }
    let paired = 0;
    let unassigned = 0;
    for (let i = 0; i < classified.length; i++) {
        const item = classified[i]!;
        if (item.role !== "unknown" || !/\.gpx$/i.test(item.file.file.name)) continue;
        const target = targetByFile.get(item);
        if (!target) {
            unassigned++;
            continue;
        }
        classified[i] = {
            ...item,
            role: "sidecar",
            sidecarId: "gpx",
            sidecarMp4: target.mp4Filename,
            manualSidecarVideoKey: target.videoKey,
        };
        paired++;
    }
    return { paired, unassigned };
}

// Resolves loose GPX files after the normal GPS logs and sidecars have parsed.
// Waiting until then is deliberate: a manual track must never be merged merely
// because its timestamps also happen to fit a clip with a known GPS source.

import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { Trip } from "../trips.js";
import { looseGpxTargets, pairAssignedLooseGpxFiles } from "./loose-gpx-assignment.js";
import { looseGpxFiles, pairLooseGpxFiles, type LooseGpxTarget } from "./loose-gpx.js";

interface LooseGpxCopy {
    clipLabel: (name: string) => string;
    unassigned: string;
    alreadyHasGps: string;
}

export interface LooseGpxResolution {
    assignedFiles: ClassifiedFile[];
    needsTrip: boolean;
}

function assignedManualGpx(classified: readonly ClassifiedFile[]): ClassifiedFile[] {
    return classified.filter(
        (item) => item.role === "sidecar" && item.sidecarId === "gpx" && item.manualSidecarVideoKey !== undefined,
    );
}

/** Adds the actual post-parse source status to a proposed target. A pending
 *  deferred embedded track is also protected: it is known to exist even though
 *  its records have not reached the candidate yet. */
function detectGps(target: LooseGpxTarget, protectedGpsVideoKeys: ReadonlySet<string>): LooseGpxTarget {
    const hasGps = target.hasGps || protectedGpsVideoKeys.has(target.videoKey);
    return hasGps === target.hasGps ? target : { ...target, hasGps };
}

export async function resolveLooseGpxFiles(
    classified: ClassifiedFile[],
    newVideos: readonly ClassifiedFile[],
    loadedTrips: readonly Trip[],
    activeTripIndex: number | null,
    protectedGpsVideoKeys: ReadonlySet<string>,
    copy: LooseGpxCopy,
): Promise<LooseGpxResolution> {
    const files = looseGpxFiles(classified);
    if (files.length === 0) return { assignedFiles: [], needsTrip: false };

    const withGps = (target: LooseGpxTarget): LooseGpxTarget => detectGps(target, protectedGpsVideoKeys);
    const targets = looseGpxTargets(newVideos, loadedTrips, activeTripIndex).map(withGps);

    if (files.length === 1 && targets.length === 1 && !targets[0]!.hasGps) {
        pairLooseGpxFiles(classified, targets[0]!);
        return { assignedFiles: assignedManualGpx(classified), needsTrip: false };
    }

    if (targets.length === 0) return { assignedFiles: [], needsTrip: true };

    const { showGpxAssignmentModal } = await import("./gpx-assignment-modal.js");
    const assignments = await showGpxAssignmentModal(files, targets, copy);
    pairAssignedLooseGpxFiles(classified, assignments);
    return { assignedFiles: assignedManualGpx(classified), needsTrip: false };
}

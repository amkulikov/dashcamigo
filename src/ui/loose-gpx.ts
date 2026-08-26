// Safe fallback for a user-supplied GPX whose basename does not match a video.
// Exact basename sidecars keep the normal parser path. A loose GPX is paired
// only when its destination is unambiguous: one video in this batch, the open
// trip on a later GPX-only drop, or the sole loaded trip.

import { recordsHaveGps } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { VendorFile } from "../parsers/types.js";
import { type Trip, tripAllCandidates } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";

const RX_GPX = /\.gpx$/i;

export interface LooseGpxTarget {
    mp4Filename: string;
    videoKey: string;
    label: string;
    hasGps: boolean;
}

function targetForVendorFile(file: VendorFile, hasGps = false): LooseGpxTarget {
    return {
        mp4Filename: file.file.name,
        videoKey: vendorFileKey(file),
        label: file.relativePath || file.file.name,
        hasGps,
    };
}

export function looseGpxTarget(
    newVideos: readonly ClassifiedFile[],
    loadedTrips: readonly Trip[],
    activeTripIndex: number | null,
): LooseGpxTarget | null {
    if (newVideos.length === 1) return targetForVendorFile(newVideos[0]!.file);
    if (newVideos.length > 1) return null;

    const activeTrip = activeTripIndex === null ? null : (loadedTrips[activeTripIndex] ?? null);
    const targetTrip = activeTrip ?? (loadedTrips.length === 1 ? loadedTrips[0]! : null);
    if (targetTrip?.frames.length !== 1) return null;
    const candidates = tripAllCandidates(targetTrip);
    const candidate = candidates[0];
    if (!candidate) return null;
    return targetForVendorFile(
        {
            file: candidate.file,
            relativePath: candidate.relativePath,
            sourceKey: candidate.sourceKey,
        },
        candidates.some((item) => recordsHaveGps(item.records)),
    );
}

/** Loose XML-GPX files that basename matching could not associate. Other
 *  `.gpx`-named camera formats keep their classifier-owned sidecar path. */
export function looseGpxFiles(classified: readonly ClassifiedFile[]): ClassifiedFile[] {
    return classified.filter((item) => item.role === "unknown" && RX_GPX.test(item.file.file.name));
}

export interface LooseGpxPairResult {
    paired: number;
    unassigned: number;
}

export function pairLooseGpxFiles(classified: ClassifiedFile[], target: LooseGpxTarget | null): LooseGpxPairResult {
    let paired = 0;
    let unassigned = 0;
    for (let i = 0; i < classified.length; i++) {
        const item = classified[i]!;
        if (item.role !== "unknown" || !RX_GPX.test(item.file.file.name)) continue;
        if (target === null || target.hasGps) {
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

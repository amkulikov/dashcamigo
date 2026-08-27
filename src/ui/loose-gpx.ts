// Discovery for a user-supplied GPX whose basename does not match a video.
// Exact basename sidecars keep the normal parser path. A loose GPX stays
// unassigned until the user chooses its destination in the assignment dialog.

import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { GpsRecord } from "../parsers/types.js";
import type { GpxTimeRange } from "../parsers/sidecars/gpx.js";

const RX_GPX = /\.gpx$/i;

export interface LooseGpxTarget {
    mp4Filename: string;
    videoKey: string;
    label: string;
    hasGps: boolean;
    timeReliable: boolean;
    footageRanges: GpxTimeRange[];
}

export interface ParsedLooseGpx {
    file: ClassifiedFile;
    records: GpsRecord[];
    timeRanges: GpxTimeRange[];
    hasExplicitTimezone: boolean;
    trackKey: string;
}

export type LooseGpxTimeMatch = "overlap" | "none" | "uncertain";

export interface LooseGpxChoice {
    target: LooseGpxTarget;
    timeMatch: LooseGpxTimeMatch;
    overlapSec: number;
}

export interface LooseGpxPlan {
    track: ParsedLooseGpx;
    choices: LooseGpxChoice[];
    recommendedVideoKey: string | null;
}

/** Loose XML-GPX files that basename matching could not associate. Other
 *  `.gpx`-named camera formats keep their classifier-owned sidecar path. */
export function looseGpxFiles(classified: readonly ClassifiedFile[]): ClassifiedFile[] {
    return classified.filter((item) => item.role === "unknown" && RX_GPX.test(item.file.file.name));
}

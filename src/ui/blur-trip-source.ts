import { candidateContentStart } from "../export-range.js";
import type { Channel } from "../parsers/types.js";
import { frameChannels, type Trip } from "../trips.js";

interface BlurSourceFile {
    file: File;
    channel: Channel;
    contentStart: number;
    durationSec: number;
    rotation: number;
}

/** Detached timing and channel assignments: ingest mutates candidates before
 * rebuilding trips, so comparing the live old and new candidates loses changes. */
export interface BlurTripSource {
    contentDurationSec: number;
    files: BlurSourceFile[];
}

export function captureBlurTripSource(trip: Trip): BlurTripSource {
    return {
        contentDurationSec: trip.timeline.contentDurationSec,
        files: trip.frames.flatMap((frame) =>
            frameChannels(frame).map((channel) => {
                const candidate = frame.channels[channel]!;
                return {
                    file: candidate.file,
                    channel,
                    contentStart: candidateContentStart(trip.timeline, candidate),
                    durationSec: candidate.durationSec,
                    rotation: candidate.rotation,
                };
            }),
        ),
    };
}

/** Regions and detector caches survive clock/GPS updates only while they still
 * refer to the same source pixels at the same content-axis times. */
export function matchesBlurTripSource(source: BlurTripSource, trip: Trip): boolean {
    const next = captureBlurTripSource(trip);
    return (
        source.contentDurationSec === next.contentDurationSec &&
        source.files.length === next.files.length &&
        source.files.every((file, index) => {
            const other = next.files[index]!;
            return (
                file.file === other.file &&
                file.channel === other.channel &&
                file.contentStart === other.contentStart &&
                file.durationSec === other.durationSec &&
                file.rotation === other.rotation
            );
        })
    );
}

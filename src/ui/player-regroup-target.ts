import type { Channel } from "../parsers/types.js";
import { frameMediaOffset, type Trip } from "../trips.js";

export interface RegroupPlaybackTarget {
    trip: number;
    frame: number;
    offsetInFrame: number;
}

/** Positional frame indices can change while a media element keeps its source. */
export function resolveRegroupPlaybackTarget(
    trips: readonly Pick<Trip, "frames">[],
    channel: Channel,
    file: File,
    mediaTime: number,
): RegroupPlaybackTarget | null {
    if (!Number.isFinite(mediaTime)) return null;
    let boundary: RegroupPlaybackTarget | null = null;
    for (let trip = 0; trip < trips.length; trip++) {
        const frames = trips[trip]!.frames;
        for (let frame = 0; frame < frames.length; frame++) {
            const interval = frames[frame]!;
            if (interval.channels[channel]?.file !== file) continue;
            const offsetInFrame = mediaTime - frameMediaOffset(interval, channel);
            if (offsetInFrame >= 0 && offsetInFrame < interval.durationSec) {
                return { trip, frame, offsetInFrame };
            }
            // A paused EOF belongs to the source's final interval; shared-file
            // internal boundaries belong to the following interval instead.
            if (offsetInFrame === interval.durationSec) boundary = { trip, frame, offsetInFrame };
        }
    }
    return boundary;
}

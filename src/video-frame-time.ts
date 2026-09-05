// A media clock can already name a seek target while the compositor still
// shows the previous frame. Privacy geometry follows presentation timestamps.

import { candidateContentStart } from "./export-range.js";
import type { TripTimeline, VideoCandidate } from "./trips.js";

/** The viewer seeks its master on the nominal file axis. Convert a privacy
 *  timestamp back through that channel's actual file placement first. */
export function playbackTimeForContent(
    timeline: TripTimeline,
    candidates: ReadonlyArray<Pick<VideoCandidate, "startUtc" | "driftLeadSec" | "durationSec">>,
    contentSec: number,
): number {
    for (const candidate of candidates) {
        const start = candidateContentStart(timeline, candidate);
        if (contentSec >= start && contentSec < start + candidate.durationSec) {
            return contentSec - (candidate.driftLeadSec ?? 0);
        }
    }
    // Missing-channel ranges must still reach the requested frame, where the
    // player selects its available fallback camera.
    return contentSec;
}

/** A geometry seed cannot be clamped to a different source frame. */
export function isEditableContentTime(contentSec: number, contentDurationSec: number): boolean {
    return Number.isFinite(contentSec) && contentSec >= 0 && contentSec < contentDurationSec;
}

export interface PresentedFrame {
    file: File;
    src: string;
    mediaTime: number;
}

export interface VideoFrameState {
    file: File | undefined;
    src: string;
    currentTime: number;
    readyState: number;
    seeking: boolean;
    isFramePending: boolean;
    hasFrameCallbacks: boolean;
}

/** Returns null until the attached source has a known displayed frame. During
 *  a seek, preview may retain the old frame's cover; editing must wait. */
export function presentedMediaTime(
    state: VideoFrameState,
    frame: PresentedFrame | null,
    requireSettled = false,
): number | null {
    if (!state.file || state.readyState < 2 || (requireSettled && (state.seeking || state.isFramePending))) return null;
    if (state.hasFrameCallbacks) {
        return frame?.file === state.file && frame.src === state.src && Number.isFinite(frame.mediaTime)
            ? frame.mediaTime
            : null;
    }
    // Engines without rVFC expose only the media clock. Never use its pending
    // seek target as geometry for the still-visible old frame.
    return !state.seeking && Number.isFinite(state.currentTime) ? state.currentTime : null;
}

import { classifyFilenameCameraKey, matchFilenameChannel, matchFilenameTime } from "./parsers/filename/index.js";
import type { Channel } from "./parsers/types.js";
import { tripAllCandidates, type Trip, type TripFrame, type VideoCandidate } from "./trips.js";
import { vendorFileKey } from "./vendor-file-key.js";

export interface UnpairedCameraIssue {
    fileKeys: string[];
}

interface CameraEvidence {
    candidate: VideoCandidate;
    frame: TripFrame;
    channel: Channel;
    filenameTime: number;
    techniqueKey: string;
}

interface PairEvidence {
    files: Set<string>;
    moments: number;
    hasPairedMoment: boolean;
}

const MIN_UNPAIRED_MOMENTS = 3;

/**
 * Finds repeated, recognized simultaneous camera files that final grouping keeps
 * apart. Call after metadata and GPS analysis settle, using the visible trip list.
 * Unknown formats and folder-only channel guesses are deliberately inconclusive.
 */
export function findUnpairedCameraIssue(trip: Trip, trips: readonly Trip[]): UnpairedCameraIssue | null {
    const selected = tripAllCandidates(trip);
    const first = selected[0];
    if (!first?.sourceKey) return null;
    const sourceKey = first.sourceKey;
    const fingerprint = first.fingerprint;
    if (selected.some((candidate) => candidate.sourceKey !== sourceKey || candidate.fingerprint !== fingerprint)) {
        return null;
    }

    const moments = new Map<number, Map<Channel, CameraEvidence>>();
    const fileKeys = new Set<string>();
    for (const loadedTrip of trips) {
        for (const frame of loadedTrip.frames) {
            for (const candidate of Object.values(frame.channels)) {
                if (candidate.sourceKey !== sourceKey || candidate.fingerprint !== fingerprint) continue;
                // Any pending sibling can still change the shared clock estimate and grouping.
                if (candidate.metadataReady !== true || candidate.metadataFailed === true) return null;
                if (candidate.recordingMode !== "normal" || candidate.isTimelapse) continue;
                const evidence = cameraEvidence(candidate, frame);
                if (!evidence) return null;
                const key = vendorFileKey(candidate);
                if (fileKeys.has(key)) return null;
                fileKeys.add(key);
                let channels = moments.get(evidence.filenameTime);
                if (!channels) {
                    channels = new Map();
                    moments.set(evidence.filenameTime, channels);
                }
                // Copies and clock resets make simultaneous-file ownership ambiguous.
                if (channels.has(evidence.channel)) return null;
                channels.set(evidence.channel, evidence);
            }
        }
    }

    const pairs = new Map<string, PairEvidence>();
    for (const channels of moments.values()) {
        const evidence = [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel, "en-US"));
        for (let i = 0; i < evidence.length; i++) {
            for (let j = i + 1; j < evidence.length; j++) {
                const a = evidence[i]!;
                const b = evidence[j]!;
                if (a.techniqueKey !== b.techniqueKey) continue;
                const key = `${a.techniqueKey}|${a.channel}|${b.channel}`;
                let pair = pairs.get(key);
                if (!pair) {
                    pair = { files: new Set(), moments: 0, hasPairedMoment: false };
                    pairs.set(key, pair);
                }
                pair.moments++;
                pair.hasPairedMoment ||= a.frame === b.frame;
                pair.files.add(vendorFileKey(a.candidate));
                pair.files.add(vendorFileKey(b.candidate));
            }
        }
    }

    const selectedKeys = new Set(selected.map(vendorFileKey));
    for (const pair of pairs.values()) {
        if (pair.moments < MIN_UNPAIRED_MOMENTS || pair.hasPairedMoment) continue;
        if (![...pair.files].some((key) => selectedKeys.has(key))) continue;
        return { fileKeys: [...pair.files] };
    }
    return null;
}

function cameraEvidence(candidate: VideoCandidate, frame: TripFrame): CameraEvidence | null {
    if (
        candidate.startSource === "mtime" ||
        !candidate.canPlay ||
        !Number.isFinite(candidate.startUtc) ||
        !Number.isFinite(candidate.durationSec) ||
        candidate.durationSec <= 0 ||
        classifyFilenameCameraKey(candidate) !== candidate.fingerprint
    ) {
        return null;
    }
    // Removing folders makes a match evidence from the actual recording name.
    const filenameOnly = { file: candidate.file, relativePath: "" };
    const channel = matchFilenameChannel(filenameOnly);
    const time = matchFilenameTime(filenameOnly);
    if (
        !channel.value ||
        !time.value ||
        channel.value.channel !== candidate.channel ||
        channel.matchedId !== candidate.classifierMatches.channel ||
        time.matchedId !== candidate.classifierMatches.time ||
        time.matchedId === "generic-datetime"
    ) {
        return null;
    }
    const filenameTime = time.value.getTime();
    if (!Number.isFinite(filenameTime)) return null;
    return {
        candidate,
        frame,
        channel: channel.value.channel,
        filenameTime,
        techniqueKey: `${time.matchedId}|${channel.matchedId}`,
    };
}

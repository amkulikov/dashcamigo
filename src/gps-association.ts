import { mergeIntoGpsLog } from "./parser.js";
import type { GpsRecord, ParsedLog, VendorFile } from "./parsers/types.js";
import type { VideoCandidate } from "./trips.js";
import { vendorFileKey } from "./vendor-file-key.js";

export interface VideoAssociationIndex {
    videosByFilename: ReadonlyMap<string, readonly VendorFile[]>;
}

export interface RecordingStartAssociationResult {
    log: ParsedLog;
    boundRecords: number;
    boundVideos: number;
}

// ISO BMFF creation_time is integer-second resolution on the cameras that
// write recording-scoped logs. One second covers rounding without letting
// adjacent clips claim the same section.
const RECORDING_START_TOLERANCE_SEC = 1;

function sameRecordingAssociation(a: NonNullable<GpsRecord["recordingAssociation"]>, b: typeof a): boolean {
    return a.startUtc === b.startUtc && a.extractorId === b.extractorId && a.sourceKey === b.sourceKey;
}

interface RecordingStartIndex {
    sources: Set<string | undefined>;
    bySecond: Map<number, VideoCandidate[]>;
}

function indexRecordingStarts(candidates: readonly VideoCandidate[]): RecordingStartIndex {
    const sources = new Set<string | undefined>();
    const bySecond = new Map<number, VideoCandidate[]>();
    for (const candidate of candidates) {
        // Include sources still waiting for metadata so another card cannot claim their logs.
        sources.add(candidate.sourceKey);
        const createdMs = candidate.createdUtc?.getTime();
        if (createdMs === undefined || !Number.isFinite(createdMs)) continue;
        // An explicitly assigned external route must never absorb a late recording log.
        if (candidate.records.some((record) => record.externalTrack)) continue;
        const second = Math.floor(createdMs / 1000);
        const bucket = bySecond.get(second);
        if (bucket) bucket.push(candidate);
        else bySecond.set(second, [candidate]);
    }
    return { sources, bySecond };
}

function findRecordingStartCandidate(
    index: RecordingStartIndex,
    hint: NonNullable<GpsRecord["recordingAssociation"]>,
): VideoCandidate | null {
    const sameSourceOnly = hint.sourceKey !== undefined && index.sources.has(hint.sourceKey);
    const second = Math.floor(hint.startUtc);
    let match: VideoCandidate | null = null;
    for (let offset = -RECORDING_START_TOLERANCE_SEC; offset <= RECORDING_START_TOLERANCE_SEC; offset++) {
        const bucket = index.bySecond.get(second + offset);
        if (!bucket) continue;
        for (const candidate of bucket) {
            if (sameSourceOnly && candidate.sourceKey !== hint.sourceKey) continue;
            if (Math.abs(candidate.createdUtc!.getTime() / 1000 - hint.startUtc) > RECORDING_START_TOLERANCE_SEC) {
                continue;
            }
            if (match) return null;
            match = candidate;
        }
    }
    return match;
}

export function buildVideoAssociationIndex(videos: readonly VendorFile[]): VideoAssociationIndex {
    const mutable = new Map<string, VendorFile[]>();
    const seen = new Set<string>();
    for (const video of videos) {
        const key = vendorFileKey(video);
        if (seen.has(key)) continue;
        seen.add(key);
        let sameName = mutable.get(video.file.name);
        if (!sameName) {
            sameName = [];
            mutable.set(video.file.name, sameName);
        }
        sameName.push(video);
    }
    return { videosByFilename: mutable };
}

/**
 * Binds recording-scoped log sections once MP4 creation metadata is known.
 * A section is accepted only when exactly one candidate starts at its header
 * time. Source scope wins when available; an unresolved tie stays inert.
 */
export function bindRecordsByRecordingStart(
    log: ParsedLog,
    candidates: readonly VideoCandidate[],
): RecordingStartAssociationResult {
    let boundRecords = 0;
    const boundCandidates = new Set<VideoCandidate>();
    let startIndex: RecordingStartIndex | undefined;

    for (const bucket of log.pendingByFilename.values()) {
        const pending: GpsRecord[] = [];
        for (const record of bucket) {
            if (record.recordingAssociation !== undefined) pending.push(record);
        }
        const hint = pending[0]?.recordingAssociation;
        if (
            !hint ||
            pending.some(
                (record) =>
                    record.recordingAssociation === undefined ||
                    !sameRecordingAssociation(record.recordingAssociation, hint),
            )
        ) {
            continue;
        }

        startIndex ??= indexRecordingStarts(candidates);
        const candidate = findRecordingStartCandidate(startIndex, hint);
        if (!candidate) continue;
        const key = vendorFileKey(candidate);
        for (const record of pending) {
            if (record.recordingAssociation === undefined) continue;
            record.mp4Filename = candidate.file.name;
            record.videoKey = key;
            delete record.recordingAssociation;
            boundRecords++;
        }
        if (!candidate.appliedExtractors.includes(hint.extractorId)) {
            candidate.appliedExtractors.push(hint.extractorId);
        }
        boundCandidates.add(candidate);
    }

    if (boundRecords === 0) return { log, boundRecords, boundVideos: 0 };
    return {
        log: mergeIntoGpsLog(null, {
            records: log.records,
            appliedExtractors: log.appliedExtractors,
            skipped: log.skipped,
        }),
        boundRecords,
        boundVideos: boundCandidates.size,
    };
}

type VideosOrIndex = readonly VendorFile[] | VideoAssociationIndex;

function asIndex(videos: VideosOrIndex): VideoAssociationIndex {
    return "videosByFilename" in videos ? videos : buildVideoAssociationIndex(videos);
}

function parentSegments(path: string): string[] {
    const segments = path.split("/").filter(Boolean);
    segments.pop();
    return segments;
}

function commonPrefixLength(a: string[], b: string[]): number {
    const length = Math.min(a.length, b.length);
    let common = 0;
    while (common < length && a[common]!.toLowerCase() === b[common]!.toLowerCase()) common++;
    return common;
}

/**
 * Resolves a basename carried by a log/sidecar to one concrete video. Source
 * scope wins, then directory proximity; an unresolved tie stays unowned so it
 * cannot contaminate several same-named recordings.
 */
export function resolveVideoKey(source: VendorFile, mp4Filename: string, videos: VideosOrIndex): string | null {
    let candidates = [...(asIndex(videos).videosByFilename.get(mp4Filename) ?? [])];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return vendorFileKey(candidates[0]!);

    if (source.sourceKey !== undefined) {
        const sameSource = candidates.filter((video) => video.sourceKey === source.sourceKey);
        if (sameSource.length === 1) return vendorFileKey(sameSource[0]!);
        if (sameSource.length > 1) candidates = sameSource;
    }

    const sourceParent = parentSegments(source.relativePath);
    let bestScore = -1;
    let best: VendorFile | null = null;
    let tied = false;
    for (const candidate of candidates) {
        const score = commonPrefixLength(sourceParent, parentSegments(candidate.relativePath));
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
            tied = false;
        } else if (score === bestScore) {
            tied = true;
        }
    }
    return best && !tied ? vendorFileKey(best) : null;
}

/** Adds a concrete video owner while the external source file is still known. */
export function associateRecordsWithVideos(
    records: readonly GpsRecord[],
    source: VendorFile,
    videos: VideosOrIndex,
): void {
    const keyByFilename = new Map<string, string | null>();
    for (const record of records) {
        let key = keyByFilename.get(record.mp4Filename);
        if (key === undefined) {
            key = resolveVideoKey(source, record.mp4Filename, videos);
            keyByFilename.set(record.mp4Filename, key);
        }
        if (key === null) delete record.videoKey;
        else record.videoKey = key;
    }
}

/**
 * Returns only records safe for one candidate. Raw basename-only records are
 * accepted when that basename names one loaded file; an ambiguous basename
 * requires an exact videoKey.
 */
export function recordsForVideo(log: ParsedLog, video: VendorFile, loadedVideos: VideosOrIndex): GpsRecord[] {
    const key = vendorFileKey(video);
    const sameNameVideos = asIndex(loadedVideos).videosByFilename.get(video.file.name) ?? [];
    if (sameNameVideos.length > 1) return log.byVideoKey.get(key) ?? [];

    const bucket = log.byFilename.get(video.file.name) ?? [];
    return bucket.filter((record) => record.videoKey === undefined || record.videoKey === key);
}

/** Rebinds candidate.records without ever falling back across an ambiguous basename. */
export function attachRecordsToCandidates(
    log: ParsedLog,
    candidates: readonly VideoCandidate[],
    loadedVideos: VideosOrIndex,
): void {
    const index = asIndex(loadedVideos);
    for (const candidate of candidates) {
        candidate.records = recordsForVideo(log, candidate, index);
    }
}

import type { GpsRecord, ParsedLog, VendorFile } from "./parsers/types.js";
import type { VideoCandidate } from "./trips.js";
import { vendorFileKey } from "./vendor-file-key.js";

export interface VideoAssociationIndex {
    videosByFilename: ReadonlyMap<string, readonly VendorFile[]>;
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

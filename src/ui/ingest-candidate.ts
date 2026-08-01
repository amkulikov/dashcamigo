// Shared VideoCandidate helpers used by BOTH the eager ingest pipeline
// (ingest.ts) and the lazy filename-first hydration path (lazy-hydrate.ts).
// Lives in its own module so neither imports the other - the dependency graph
// stays tree-shaped.

import type { VideoCodec } from "mediabunny";

import { createLogger } from "../log.js";
import { type IndexerRepair } from "../indexer.js";
import type { IndexedMp4 } from "../workers/indexer-protocol.js";
import type { GpsRecord, VendorFile } from "../parsers/types.js";
import {
    classifyFilenameTimelapse,
    matchFilenameChannel,
    matchFilenameMode,
    matchFilenameSequence,
    matchFilenameTime,
} from "../parsers/filename/index.js";
import { isMatroskaName, isTransportStreamName } from "../video-format-names.js";
import type { StartSource, VideoCandidate } from "../trips.js";

const log = createLogger("ingest-candidate");

/**
 * Unique key for a file in the drag-drop pool. relativePath includes the SD
 * subdirectory ("Normal/Front/NO20260101-120000-000001F.MP4"), distinguishing
 * files with the same basename from different folders (multi-channel SD: F/B/I
 * in separate folders, backup folders, two dashcams in one drop). Falls back to
 * name if path is empty.
 *
 * Note: GPS attachment to video still uses basename (GpsRecord.mp4Filename) -
 * that is the parser contract and what real log formats write.
 */
export function vendorFileKey(vf: VendorFile): string {
    return vf.relativePath || vf.file.name;
}

/**
 * Builds a zero-copy patched File from the indexer worker's container-repair
 * descriptor (broken hvcC / phantom track). The patched moov replaces the
 * original moov region via Blob concatenation - only the moov copy (tens of KB)
 * is materialized; the huge mdat stays a lazy file.slice() reference. The patch
 * is constant-size, so every byte offset outside moov stays valid.
 */
export function applyMoovRepair(file: File, repair: IndexerRepair): File {
    const patchedBlob = new Blob(
        [
            file.slice(0, repair.moovFileStart),
            repair.patchedMoov as unknown as BlobPart,
            file.slice(repair.moovFileEnd),
        ],
        { type: file.type },
    );
    return new File([patchedBlob], file.name, { type: file.type, lastModified: file.lastModified });
}

/** Outcome of applying an indexer repair: the (possibly patched) file, the
 *  post-repair needsHevcRemux, and which repair kinds fired (for the toasts). */
export interface RepairApplication {
    file: File;
    needsHevcRemux: boolean;
    phantomRepaired: boolean;
    hvccRepaired: boolean;
}

/**
 * Applies the indexer's container-repair descriptor (or passes the file through
 * untouched when there is none). Single source of truth for "patched file +
 * post-repair needsHevcRemux + repair counters", shared by the eager index
 * callback and lazy hydration so they cannot diverge.
 */
export function applyIndexRepair(
    file: File,
    indexedNeedsHevcRemux: boolean,
    repair: IndexerRepair | undefined,
): RepairApplication {
    if (!repair) {
        return { file, needsHevcRemux: indexedNeedsHevcRemux, phantomRepaired: false, hvccRepaired: false };
    }
    return {
        file: applyMoovRepair(file, repair),
        // hvcC repair recomputes needsHevcRemux (it may flip a previously-broken
        // descriptor to the native path); a phantom-only repair keeps the indexed value.
        needsHevcRemux: repair.hvcc ? repair.hvcc.needsHevcRemux : indexedNeedsHevcRemux,
        phantomRepaired: repair.phantomNeutralized.length > 0,
        hvccRepaired: repair.hvcc != null,
    };
}

/** The filename-derived candidate fields (channel/sequence/mode/classifier ids).
 *  Identical for the eager and the provisional builders - one definition so the
 *  two paths cannot drift on the confidence default or the matchedId mapping. */
export interface FilenameClassifierFields {
    classifierMatches: VideoCandidate["classifierMatches"];
    channel: VideoCandidate["channel"];
    channelConfident: boolean;
    sequence: VideoCandidate["sequence"];
    recordingMode: VideoCandidate["recordingMode"];
    isTimelapse: boolean;
}

/** Walks the per-field filename technique libraries and maps the matches onto the
 *  VideoCandidate's filename-derived fields. Shared by the eager pipeline and the
 *  filename-first provisional builder. */
export function filenameClassifierFields(file: VendorFile): FilenameClassifierFields {
    const timeMatch = matchFilenameTime(file);
    const channelMatch = matchFilenameChannel(file);
    const modeMatch = matchFilenameMode(file);
    const sequenceMatch = matchFilenameSequence(file);
    return {
        classifierMatches: {
            time: timeMatch.matchedId,
            channel: channelMatch.matchedId,
            mode: modeMatch.matchedId,
            sequence: sequenceMatch.matchedId,
        },
        channel: channelMatch.value?.channel ?? null,
        channelConfident: channelMatch.value?.confident ?? false,
        sequence: sequenceMatch.value,
        recordingMode: modeMatch.value,
        isTimelapse: classifyFilenameTimelapse(file),
    };
}

/** Parameters for a provisional (filename-only) VideoCandidate. */
export interface ProvisionalCandidateParams {
    file: VendorFile;
    fingerprint: string;
    startUtc: number;
    startSource: StartSource;
    /** Display-clock zone snapshot (per-fingerprint filenameTzSec), null when unknown. */
    cameraTzSec: number | null;
    /** Per-fingerprint provisional duration (estimateProvisionalDurationByFingerprint). */
    durationSec: number;
    records: GpsRecord[];
    appliedExtractors: string[];
}

/**
 * Builds a VideoCandidate from the filename alone - zero file-byte reads. Used
 * by the filename-first ingest path to render the trip list before any moov is
 * read. Byte-derived fields (codec/createdUtc/rotation/...) carry safe
 * optimistic placeholders and hydrated=false; hydrateCandidateFromIndex fills
 * the real values later. The mapping mirrors the eager builder in ingest.ts.
 */
export function buildProvisionalCandidate(params: ProvisionalCandidateParams): VideoCandidate {
    const { file } = params;
    return {
        file: file.file,
        relativePath: file.relativePath,
        fingerprint: params.fingerprint,
        appliedExtractors: params.appliedExtractors,
        ...filenameClassifierFields(file),
        startUtc: params.startUtc,
        durationSec: params.durationSec,
        // Provisional: no moov/GPS read yet, so no wall-span evidence; the
        // post-hydration rederive sweep fills the real value.
        wallDurationSec: null,
        // Computed at regroup time (applyChannelDriftLead), never at construction.
        driftLeadSec: null,
        startSource: params.startSource,
        cameraTzSec: params.cameraTzSec,
        records: params.records,
        createdUtc: null,
        codec: null,
        // Optimistic until hydration's canPlay check; null codec stays true (let <video> try).
        canPlay: true,
        codecParam: null,
        videoCodecString: null,
        rotation: 0,
        // Byte-derived display metadata - unknown until the moov read (hydrate).
        width: null,
        height: null,
        fps: null,
        audio: null,
        needsHevcRemux: false,
        isTransportStream: isTransportStreamName(file.file.name),
        isMatroska: isMatroskaName(file.file.name),
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
        localClockOffsetHintSec: null,
        hydrated: false,
    };
}

/**
 * Fills a provisional candidate's byte-derived fields from a fresh index result,
 * in place (the same object is referenced by the trip's frames, so mutation is
 * what makes the rendered card update). Applies any container repair via
 * applyIndexRepair and flips hydrated=true. Returns which repairs fired so the
 * caller can count them for the post-ingest toast.
 */
export function hydrateCandidateFromIndex(
    candidate: VideoCandidate,
    indexed: IndexedMp4,
    repair: IndexerRepair | undefined,
): { phantomRepaired: boolean; hvccRepaired: boolean } {
    const applied = applyIndexRepair(candidate.file, indexed.needsHevcRemux, repair);
    candidate.file = applied.file;
    candidate.durationSec = indexed.durationSec;
    candidate.createdUtc = indexed.createdUtc;
    candidate.codec = indexed.codec;
    candidate.codecParam = indexed.codecParam;
    candidate.videoCodecString = indexed.videoCodecString;
    candidate.rotation = indexed.rotation;
    candidate.width = indexed.width;
    candidate.height = indexed.height;
    candidate.fps = indexed.fps;
    candidate.audio = indexed.audio;
    candidate.needsHevcRemux = applied.needsHevcRemux;
    candidate.audioNeedsTranscode = indexed.audioNeedsTranscode;
    candidate.hydrated = true;
    if (repair) {
        log.info("applied container repair", {
            file: candidate.file.name,
            phantom: repair.phantomNeutralized,
            hvcc: repair.hvcc?.reason ?? null,
        });
    }
    return { phantomRepaired: applied.phantomRepaired, hvccRepaired: applied.hvccRepaired };
}

/**
 * Sets each candidate's canPlay by probing codec decodability (mediabunny
 * canDecodeVideo, deduped by codec string). Extracted from the eager pipeline so
 * the lazy path can run the same check over just one trip's candidates. A
 * codec=null candidate stays optimistically playable; a thrown probe also
 * defaults to playable (a black frame beats a false "unsupported" overlay).
 */
export async function checkCanPlay(candidates: VideoCandidate[]): Promise<void> {
    // Key = videoCodecString when present, else the codec enum.
    const checks = new Map<string, { codec: VideoCodec; codecString: string | null }>();
    for (const c of candidates) {
        if (!c.codec) continue;
        const key = c.videoCodecString ?? c.codec;
        if (!checks.has(key)) checks.set(key, { codec: c.codec, codecString: c.videoCodecString });
    }
    const decodableByKey = new Map<string, boolean>();
    // Dynamic import: this module is eager (app.ts -> lazy-embedded-gps), and a
    // static value import of mediabunny here would drag its whole ~300 KB graph
    // into the landing entry chunk (guarded by scripts/check-lazy-chunks.mjs).
    // The probe already awaits per-codec checks, so one more await is free.
    const { canDecodeVideo } = await import("mediabunny");
    await Promise.all(
        [...checks].map(async ([key, { codec, codecString }]) => {
            try {
                decodableByKey.set(key, await canDecodeVideo(codec, codecString ? { codec: codecString } : undefined));
            } catch (err) {
                log.warn("codec check threw, optimistically allowing playback", {
                    codec,
                    codecString,
                    err: err instanceof Error ? err.message : String(err),
                });
                decodableByKey.set(key, true);
            }
        }),
    );
    for (const c of candidates) {
        c.canPlay = c.codec ? (decodableByKey.get(c.videoCodecString ?? c.codec) ?? true) : true;
    }
}

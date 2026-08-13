// Registry / dispatch facade. Capability-first architecture:
//   - primitives/ - one byte-parsing format = one file with marker+parse.
//   - filename/<field>.ts - per-field technique lists (time/channel/mode/sequence).
//   - gps-source-hints.ts - declarative source registry (where GPS lives).
//   - sidecars/ - basename-paired sidecar handlers (GPX, .map, .3gf, .gps).
//
// This file is a thin wrapper for ingest.ts / worker compatibility:
//   - classifyFiles                 - assigns FileRole by extension + log-sidecar markers + sidecar matchers.
//   - classifyOneNonVideo           - per-file helper reused by main + ingest-worker.
//   - dispatchParseVideoEmbeddedGps - video-embedded GPS via primitives.
//   - mergeAccelSamples             - merges accel-only samples into GpsRecord by unix time.
//
// Log-sidecar / GPS-sidecar / accel-sidecar dispatch lives in src/ui/ingest-shim.ts
// (worker-pool path); the main thread no longer has its own sync dispatchers.
//
// SIDECARS / ACCEL_SIDECARS lists live here. Log-sidecar and video-embedded
// primitives live in primitives/index.ts. Filename classification lives in
// filename/index.ts and is called directly by ingest.ts / trips.ts.

import { extendArray } from "../array-extend.js";
import { createLogger } from "../log.js";
import { forwardFillBearingsIfAllZero } from "../parser.js";
// The light, main-thread-safe classification helpers live in registry-light.ts
// (see the rationale there); re-exported for the worker-side callers that
// already import everything from this module.
import { type ClassifiedFile, splitVideosByExtension } from "./registry-light.js";

export { type ClassifiedFile, mergeAccelSamples, RX_VIDEO_EXT, splitVideosByExtension } from "./registry-light.js";
import {
    type AccelSample,
    type AccelSidecarHandler,
    type GpsRecord,
    type SidecarHandler,
    type SkippedLine,
    type VendorFile,
    WrongFormatError,
} from "./types.js";
import {
    DEFAULT_PROBE_BYTES,
    MAX_PROBE_BYTES,
    type Mp4Index,
    buildMp4Index,
    probeMarkers,
} from "./internal/mp4-index.js";
import { hasAutoVoxTrailerSignature } from "./internal/autovox-riff.js";
import { findGarminUuidBox } from "./internal/garmin-uuid.js";
import { findKenwoodMoovUdta, hasKenwoodUdtaMarker, KENWOOD_TRAILER_PROBE_BYTES } from "./internal/kenwood.js";
import { hasGkuMarker, hasLigoJsonMarker } from "./internal/ligo-json.js";
import { needsGpsProbeEscalation } from "./filename/_patterns.js";
import { findNovatekTsGpsPid } from "./internal/novatek-ts-extract.js";
import { findTsPesGpsStream } from "./internal/ts-pes-gps.js";
import { hasNextbaseGdatHead } from "./internal/nextbase-gdat.js";
import { hasTextGpsLogAtom } from "./internal/text-gpslog-atom.js";
import { LOG_SIDECAR_PRIMITIVES, VIDEO_EMBEDDED_PRIMITIVES } from "./primitives/index.js";
import { blackvue3gfSidecar } from "./sidecars/blackvue-3gf.js";
import { escortMapSidecar } from "./sidecars/escort-map.js";
import { gpxSidecar } from "./sidecars/gpx.js";
import { blackvueGpsSidecar, ddpaiGpxSidecar, nmeaSidecar } from "./sidecars/nmea-sidecar.js";

const log = createLogger("dispatch");

// SidecarHandler in priority order. ddpaiGpxSidecar must precede gpxSidecar:
// DDPai's `.gpx` files are actually NMEA, and the XML-only gpxSidecar would
// throw on them, leaving the MP4 without GPS.
//
// Exported for ingest-shim/ingest-worker (worker uses the list minus gpx,
// which needs DOMParser and runs on main).
export const SIDECARS: readonly SidecarHandler[] = [
    ddpaiGpxSidecar,
    gpxSidecar,
    blackvueGpsSidecar,
    escortMapSidecar,
    nmeaSidecar,
];

export const ACCEL_SIDECARS: readonly AccelSidecarHandler[] = [blackvue3gfSidecar];

/**
 * Classifies a single non-video file. Tries log-sidecar markers, then
 * sidecar handlers, then accel-sidecar handlers; returns unknown if nothing
 * matches.
 *
 * sidecarHandlers / accelHandlers are passed in (not read from the module
 * level) so the ingest-worker can pass a list with gpxSidecar filtered out -
 * GPX needs DOMParser and is handled on main.
 */
export async function classifyOneNonVideo(
    file: VendorFile,
    knownVideos: Set<string>,
    sidecarHandlers: readonly SidecarHandler[],
    accelHandlers: readonly AccelSidecarHandler[],
): Promise<ClassifiedFile> {
    // log-sidecar (by content: 70mai $V etc.).
    for (const extractor of LOG_SIDECAR_PRIMITIVES) {
        try {
            if (await extractor.marker(file)) {
                return {
                    file,
                    role: "gps-log",
                    sidecarId: null,
                    sidecarMp4: null,
                    logExtractorId: extractor.id,
                };
            }
        } catch (err) {
            log.debug("log-sidecar marker threw", { extractor: extractor.id, file: file.file.name, err });
        }
    }

    // gps-sidecar handler (by basename).
    for (const handler of sidecarHandlers) {
        const mp4 = handler.matches(file, knownVideos);
        if (mp4 === null) continue;
        return {
            file,
            role: "sidecar",
            sidecarId: handler.id,
            sidecarMp4: mp4,
            logExtractorId: null,
        };
    }

    // accel-only sidecar.
    for (const handler of accelHandlers) {
        const mp4 = handler.matches(file, knownVideos);
        if (mp4 === null) continue;
        return {
            file,
            role: "accel-sidecar",
            sidecarId: handler.id,
            sidecarMp4: mp4,
            logExtractorId: null,
        };
    }

    return {
        file,
        role: "unknown",
        sidecarId: null,
        sidecarMp4: null,
        logExtractorId: null,
    };
}

/**
 * Classifies files by role. Video is decided by extension; non-video tries
 * log-sidecar extractor markers, then gps-sidecar handlers, then accel-sidecar
 * handlers, otherwise unknown.
 *
 * existingVideoNames - MP4 names already in state.trips. The user can drop a
 * GPX later for a previously loaded MP4; sidecars match those too.
 *
 * Main-thread path that uses the full SIDECARS / ACCEL_SIDECARS lists. The
 * ingest worker pool path lives in src/ui/ingest-shim.ts and calls
 * classifyOneNonVideo with a gpx-less list.
 */
export async function classifyFiles(
    files: VendorFile[],
    existingVideoNames: Iterable<string> = [],
): Promise<ClassifiedFile[]> {
    const { videoEntries, knownVideos, nonVideo } = splitVideosByExtension(files, existingVideoNames);
    const result: ClassifiedFile[] = [...videoEntries];
    for (const vf of nonVideo) {
        result.push(await classifyOneNonVideo(vf, knownVideos, SIDECARS, ACCEL_SIDECARS));
    }
    return result;
}

// === Video-embedded GPS dispatch ===

export interface DispatchedEmbeddedGpsResult {
    /** Primitive ids that produced records. */
    appliedExtractors: string[];
    records: GpsRecord[];
    skipped: SkippedLine[];
    errors: Array<{ file: string; extractor: string; message: string }>;
    /**
     * mp4 filename -> winning extractor id. Used by ingest.ts/lazy to stash
     * appliedExtractors into diagnostics; UI does not look at this.
     */
    winningExtractorByFilename: Map<string, string>;
    /**
     * mp4 filename -> wall-clock UTC of video frame 0 if the extractor could
     * tie it (RVMI tReV baseline). Authoritative startUtc input - consumed by
     * deriveStartUtc via VideoCandidate.embeddedStartUtcHint. Absent when the
     * winning extractor has no such anchor (most formats).
     */
    videoStartUtcHintByFilename: Map<string, number>;
    /**
     * mp4 filename -> local-as-UTC clock offset evidence from the winning
     * extractor (ParsedRecords.localClockOffsetHintSec). Aggregated per
     * fingerprint and subtracted from the record axis by
     * applyLocalClockCorrections in trips.ts. Absent for honest-UTC files.
     */
    localClockOffsetHintByFilename: Map<string, number>;
    /**
     * mp4 filename -> accelerometer samples the winning extractor found inside
     * the container (embedded `3gf `, `gsen`, binary preambles). Same shape and
     * meaning as the accel-sidecar map, so both feed one mergeAccelSamples call
     * via combineAccelSources. Empty for the formats that carry accel directly
     * on GpsRecord, which is most of them.
     */
    accelByFilename: Map<string, AccelSample[]>;
    /**
     * Files classified as "heavy" and deferred under mode="light-only".
     * Empty under mode="all". Each file is a ClassifiedFile (with role="video").
     */
    heavyFiles: ClassifiedFile[];
}

type EmbeddedGpsProgressCallback = (done: number, total: number, file: VendorFile) => void;
type EmbeddedGpsKind = "none" | "light" | "mid" | "heavy";
type EmbeddedGpsExtractionMode = "all" | "light-only";

/**
 * Light/mid/heavy/none gate for video-embedded extraction:
 *  - light: cheap structural reads (sample-table from moov, sparse free-gps
 *    slices, tail atoms).
 *  - mid: Novatek streaming where the predicted-offset jump scan can
 *    bootstrap (>= 2 freeGPS seed offsets in the probe window).
 *    Cost ~30 MB IO per file - safe to auto-parse without user prompt.
 *  - heavy: Novatek streaming with no seed offsets - the predicted-offset
 *    jump scan cannot bootstrap, only the linear 500 MB-1 GB fallback
 *    works. Deferred to lazy on-trip-click.
 *  - none: no GPS markers detected.
 *
 * Decision is made AFTER selecting an extractor - classifyEmbeddedGpsKind is
 * called with the index, not a specific extractor (one Mp4Index covers all
 * markers).
 */
function classifyEmbeddedGpsKind(index: Mp4Index): EmbeddedGpsKind {
    if (index.freeGpsBoxInsideFree !== null) return "light";
    if (index.novatekGpsAtom !== null) return "light";
    if (index.hasLigoGpsMarker) return "light";
    if (index.navitelGps0Atom !== null) return "light";
    // Novatek GPS struct in a private PES inside MPEG-TS (novatek-ts
    // primitive): no moov, no atom markers - detect by scanning the header
    // probe bytes for the GPS PID. Self-rejects non-TS buffers in O(1)
    // (first byte is not the 0x47 sync byte), so MP4 files pay nothing.
    // "light" mirrors the juscar/hasLigoGpsMarker precedent (parse is the
    // same linear full-file PES scan).
    if (index.headerBytes && findNovatekTsGpsPid(index.headerBytes) !== null) return "light";
    // Same no-moov container class: INNOVV / DOD LS600W private PES.
    if (index.headerBytes && findTsPesGpsStream(index.headerBytes) !== null) return "light";
    // TS files whose GPS table sits in the EOF trailer (ligogps-trailer-ts).
    // Detected during indexing precisely so this gate stays synchronous.
    if (index.tsGpsTrailer !== null) return "light";
    // Older 70mai Pro: a top-level `GPS ` box decoded by gps-box-70mai. Cheap -
    // one bounded slice of the box - so "light". Without this the kind gate
    // returns "none" and tryParseOne short-circuits before the primitive runs.
    if (index.maiGpsBox !== null) return "light";
    // Top-level udta carriers: Kenwood VIDEOUUU records and LigoJSON/GKU
    // plaintext JSON (kenwood / ligo-json primitives). Sync head checks over
    // the already-read udta heads - without this wiring those primitives are
    // dead in production (the maiGpsBox regression class, see
    // __fixtures__/dispatch-gate.test.ts).
    for (const udta of index.topLevelUdtaAtoms) {
        if (!udta.head) continue;
        if (hasKenwoodUdtaMarker(udta.head) || hasLigoJsonMarker(udta.head) || hasGkuMarker(udta.head)) {
            return "light";
        }
    }
    // Top-level text GPS logs (gpslog-atom) and Nextbase `gdat` (nextbase-gdat)
    // - head checks over the bytes read during indexing, like the udta carriers.
    if (hasTextGpsLogAtom(index)) return "light";
    if (index.topLevelGdatAtom?.head && hasNextbaseGdatHead(index.topLevelGdatAtom.head)) return "light";
    // Kenwood moov/udta carrier - sync scan over the in-memory moov bytes.
    if (findKenwoodMoovUdta(index) !== null) return "light";
    // Garmin DriveAssist 51 moov/uuid carrier - sync scan, zero IO.
    if (findGarminUuidBox(index) !== null) return "light";
    // Auto-Vox RIFF trailer - the head of the trailing region was read during
    // indexing precisely so this check stays synchronous.
    if (index.trailerHead && hasAutoVoxTrailerSignature(index.trailerHead)) return "light";
    for (const t of index.tracks) {
        if (t.sampleFormat === "RVMI") return "light";
        // gpmd is an stsd sample format, not an hdlr handler type: GoPro pairs
        // it with handler "meta" (caught below), but a gpmd sample entry under
        // any other handler must still pass the gate - otherwise the file
        // classifies "none" and tryParseOne short-circuits before the gpmf
        // primitive's marker (which keys on sampleFormat) ever runs.
        if (t.sampleFormat === "gpmd") return "light";
        if (!t.handlerType) continue;
        // tvxt: Vueroid GPS+accel track (vueroid-txet primitive).
        if (
            t.handlerType === "sbtl" ||
            t.handlerType === "text" ||
            t.handlerType === "meta" ||
            t.handlerType === "tvxt"
        ) {
            return "light";
        }
    }
    if (index.hasFreeGpsMarker) {
        return index.freeGpsSeedOffsets.length >= 2 ? "mid" : "heavy";
    }
    // Kenwood CCCC trailer: the actual marker needs a file read, which this
    // sync zero-IO gate cannot do - gate on "trailing non-box bytes big
    // enough to hold the trailer probe" instead. Deliberately LAST: any
    // junk-tailed file classifies "light" through this, which is acceptable
    // (light only means a cheap primitive marker walk runs, and the kenwood
    // marker's ~40-byte probe then rejects non-Kenwood tails), but it must
    // never pre-empt the mid/heavy Novatek streaming classification above.
    if (index.lastTopLevelBoxEnd !== null && index.lastTopLevelBoxEnd + KENWOOD_TRAILER_PROBE_BYTES <= index.fileSize) {
        return "light";
    }
    return "none";
}

/**
 * Whether tryParseOne must run the 4 MB freeGPS/LigoGPS marker probe before the
 * extractor walk. Returns false ONLY when the moov already carries an EXCLUSIVE
 * structural GPS signal - one a probe-free extractor owns outright, with no
 * probe-dependent extractor competing for the same file. For those formats the
 * probe is pure wasted IO (the GPS lives in the moov atom / track samples the
 * extractor reads directly), so we skip it.
 *
 * Returns true (probe, exactly as the pipeline always did) for the ambiguous and
 * markerless cases, where skipping would silently lose GPS or break the walk's
 * ordering invariants:
 *  - `meta` handler tracks: shared between probe-free extractors (rove-ssmd) AND
 *    ligogps, whose marker keys on hasLigoGpsMarker (probe). `sbtl`/`text` are
 *    NOT shared (pndm/nmea/nextbase read the first SAMPLE, not the probe), so
 *    they stay probe-free.
 *  - novatekGpsAtom: freegps owns it, but its streaming fallback needs
 *    freeGpsSeedOffsets, and freegps-70mai - earlier in the walk for 70mai files
 *    - keys on hasFreeGpsMarker; both require the probe to be present so the
 *    extractor walk picks the right primitive.
 *  - no structural signal at all (pure-streaming Novatek, Juscar TS LigoGPS,
 *    70mai 4K): classification itself depends on the probe markers.
 *
 * MUST stay in sync with classifyEmbeddedGpsKind's structural branches above:
 * every "light" trigger here that is exclusive-structural returns false, and the
 * probe-derived/shared triggers (hasLigoGpsMarker, hasFreeGpsMarker, meta,
 * novatekGpsAtom, the kenwood trailer-anchor fallback) fall through to true.
 */
function embeddedGpsProbeNeeded(index: Mp4Index): boolean {
    if (index.freeGpsBoxInsideFree !== null) return false; // BlackVue X-series (free-gps-box)
    if (index.navitelGps0Atom !== null) return false; // Navitel R-series / iBox (navitel-tail)
    if (index.maiGpsBox !== null) return false; // older 70mai Pro (gps-box-70mai)
    for (const t of index.tracks) {
        // gpmd (gpmf/wolfbox/vantrue) and RVMI (rvmi) own their sample formats;
        // sbtl/text (pndm/nmea/nextbase) and tvxt (vueroid-txet) read the
        // first sample, not the probe.
        // `meta` is deliberately excluded - ligogps shares it and needs the probe.
        if (t.sampleFormat === "RVMI" || t.sampleFormat === "gpmd") return false;
        if (t.handlerType === "sbtl" || t.handlerType === "text" || t.handlerType === "tvxt") return false;
    }
    for (const udta of index.topLevelUdtaAtoms) {
        if (!udta.head) continue;
        if (hasKenwoodUdtaMarker(udta.head) || hasLigoJsonMarker(udta.head) || hasGkuMarker(udta.head)) return false;
    }
    // Content-gated, not presence-gated: an unrelated udat/nbmt/gdat is not a
    // structural GPS signal, and skipping the probe for it only defers the work
    // to the no-winner retry below.
    if (hasTextGpsLogAtom(index)) return false;
    if (index.topLevelGdatAtom?.head && hasNextbaseGdatHead(index.topLevelGdatAtom.head)) return false;
    if (findKenwoodMoovUdta(index) !== null) return false; // Kenwood moov/udta carrier
    if (findGarminUuidBox(index) !== null) return false; // Garmin DriveAssist 51
    // Auto-Vox RIFF trailer (autovox-riff): content-gated on the AITG/AITS
    // record magic behind the chunk name, and the extractor reads the trailer
    // itself - the probe window at the head of the file is pure waste.
    if (index.trailerHead && hasAutoVoxTrailerSignature(index.trailerHead)) return false;
    return true;
}

interface WorkItem {
    primary: ClassifiedFile;
    followers: ClassifiedFile[];
}

/**
 * Groups video files by cloneAcrossGroup key. Files for which no extractor
 * declared a clone key go as a single-file work item.
 */
function buildWorkItems(videos: ClassifiedFile[]): WorkItem[] {
    const items: WorkItem[] = [];
    const groups = new Map<string, ClassifiedFile[]>();

    for (const c of videos) {
        let groupKey: string | null = null;
        let owningExtractorId: string | null = null;
        for (const extractor of VIDEO_EMBEDDED_PRIMITIVES) {
            if (!extractor.cloneAcrossGroup) continue;
            const key = extractor.cloneAcrossGroup(c.file);
            if (key !== null) {
                groupKey = key;
                owningExtractorId = extractor.id;
                break;
            }
        }
        if (groupKey === null || owningExtractorId === null) {
            items.push({ primary: c, followers: [] });
            continue;
        }
        const fullKey = `${owningExtractorId}:${groupKey}`;
        let arr = groups.get(fullKey);
        if (!arr) {
            arr = [];
            groups.set(fullKey, arr);
        }
        arr.push(c);
    }

    for (const arr of groups.values()) {
        if (arr.length === 1) {
            items.push({ primary: arr[0]!, followers: [] });
        } else {
            items.push({ primary: arr[0]!, followers: arr.slice(1) });
        }
    }
    return items;
}

/**
 * Parses embedded GPS from every video file in classified.
 *
 *  1. Build Mp4Index per file (adaptive moov + 4 MB probe + structural atoms).
 *     One index is reused by all extractors.
 *  2. Walk VIDEO_EMBEDDED_PRIMITIVES by marker(); first match parses.
 *  3. cloneAcrossGroup (Juscar): for a group we parse one file, records are
 *     cloned onto the rest with mp4Filename rewritten.
 *  4. mode="light-only" defers files classified as "heavy" (Novatek streaming
 *     with no jump-scan seeds) to heavyFiles for lazy on-trip-click parsing.
 *     "mid" files (jump-scan-able streaming, ~30 MB IO/file) still parse here.
 */
export async function dispatchParseVideoEmbeddedGps(
    classified: ClassifiedFile[],
    onProgress?: EmbeddedGpsProgressCallback,
    concurrency = 4,
    signal?: AbortSignal,
    mode: EmbeddedGpsExtractionMode = "all",
    /**
     * Optional map of relativePath -> raw moov bytes (full moov box, 8-byte
     * header included), supplied by the ingest pipeline so buildMp4Index
     * skips its own moov read on cold SD. Keys are relativePath (vendorFileKey),
     * not basename, so same-basename files in different folders do not collide.
     * Missing entries fall back to the normal file.slice read.
     */
    prebuiltMoovByPath?: Map<string, Uint8Array>,
): Promise<DispatchedEmbeddedGpsResult> {
    const videos = classified.filter((c) => c.role === "video");
    const allRecords: GpsRecord[] = [];
    const allSkipped: SkippedLine[] = [];
    const errors: Array<{ file: string; extractor: string; message: string }> = [];
    const used = new Set<string>();
    const winningExtractorByFilename = new Map<string, string>();
    const videoStartUtcHintByFilename = new Map<string, number>();
    const localClockOffsetHintByFilename = new Map<string, number>();
    const accelByFilename = new Map<string, AccelSample[]>();
    const heavyFiles: ClassifiedFile[] = [];

    const workItems = buildWorkItems(videos);
    let cursor = 0;
    let done = 0;

    type ParseResult = {
        extractorId: string;
        records: GpsRecord[];
        skipped: SkippedLine[];
        videoStartUtcHint: number | undefined;
        localClockOffsetHintSec: number | undefined;
        accelSamples: AccelSample[] | undefined;
    };

    // Classifies the index kind (with the Novatek MAX-probe escalation) and
    // walks the extractors. Returns the winning ParseResult, "heavy-deferred"
    // when a heavy file is skipped under light-only, or null when no extractor
    // claims the file. Split out from tryParseOne so the no-winner probe retry
    // can re-run it on the same index after a lazy probe.
    const classifyAndWalk = async (vf: VendorFile, index: Mp4Index): Promise<ParseResult | "heavy-deferred" | null> => {
        let kind = classifyEmbeddedGpsKind(index);
        if (kind === "none" && needsGpsProbeEscalation(vf.file.name)) {
            // Probe escalation: the default 4 MB probe can miss the first
            // freeGPS block on a high-bitrate clip (1 Hz blocks in mdat; a 4K
            // HEVC stream at ~50 Mbps puts the first one past 6 MB). The
            // predicate also covers the TS twin of the same problem (first
            // GPS PES observed at ~3-4 MB); its format list lives next to the
            // regexes in filename/_patterns.ts. Both
            // conjuncts matter: normal VIOFO/Vantrue firmware writes the moov
            // `gps ` table, which classifies "light" regardless of the probe
            // window - escalation only serves table-less old-firmware/clone
            // files. The premise is bitrate arithmetic, not an observed
            // failing sample; ExifTool's equivalent scan cap is 20e6 bytes
            // (QuickTimeStream.pl ScanMediaData, sub at :3681, cap at :3715).
            // Known inefficiency, accepted: a file that escalates to "heavy"
            // here re-pays this 16 MB probe on the lazy on-trip-click
            // re-parse, because each pass builds a fresh Mp4Index.
            await probeMarkers(vf.file, index, MAX_PROBE_BYTES);
            kind = classifyEmbeddedGpsKind(index);
        }
        if (kind === "none") return null;
        if (mode === "light-only" && kind === "heavy") return "heavy-deferred";

        for (const extractor of VIDEO_EMBEDDED_PRIMITIVES) {
            if (signal?.aborted) return null;
            let matched = false;
            try {
                matched = await extractor.marker(vf, index);
            } catch (err) {
                log.debug("extractor marker threw", {
                    extractor: extractor.id,
                    file: vf.file.name,
                    err: err instanceof Error ? err.message : String(err),
                });
            }
            if (!matched) continue;

            try {
                const parsed = await extractor.parse(vf, index, signal);
                // Zero records + no hint = "matched the shape, carries no GPS":
                // keep walking, a sibling extractor may still own the file's
                // GPS (e.g. an empty gpmd track next to freeGPS in mdat). Zero
                // records WITH a hint is a positive claim - a quality-gated
                // parse (sstar-ssmd phantom-track gate) that dropped fabricated
                // fixes but kept the frame-0 clock anchor and skip diagnostics.
                if (parsed.records.length === 0 && parsed.videoStartUtcHint === undefined) continue;
                // Run before returning to the per-file merge - centralized
                // forward-fill covers parsers that don't write course (PNDM,
                // Navitel gps0, LigoGPS) without each parser having to remember.
                forwardFillBearingsIfAllZero(parsed.records);
                return {
                    extractorId: extractor.id,
                    records: parsed.records,
                    skipped: parsed.skipped,
                    videoStartUtcHint: parsed.videoStartUtcHint,
                    localClockOffsetHintSec: parsed.localClockOffsetHintSec,
                    accelSamples: parsed.accelSamples,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // AbortError propagates - the outer worker loop checks
                // signal.aborted between work items, but a per-extractor
                // signal-honoring parse can also raise it directly.
                if (err instanceof DOMException && err.name === "AbortError") throw err;
                if (!(err instanceof WrongFormatError)) {
                    errors.push({ file: vf.file.name, extractor: extractor.id, message });
                    log.warn("video extractor parse failed", {
                        extractor: extractor.id,
                        file: vf.file.name,
                        err: message,
                    });
                }
            }
        }
        return null;
    };

    const tryParseOne = async (vf: VendorFile): Promise<ParseResult | "heavy-deferred" | null> => {
        let index: Mp4Index;
        try {
            const prebuiltMoov = prebuiltMoovByPath?.get(vf.relativePath || vf.file.name);
            // Build WITHOUT the marker probe first. For files whose GPS lives in a
            // moov atom or a media track (most formats), the 4 MB freeGPS/LigoGPS
            // literal scan is pure wasted IO - dominant cost on mobile SD/UFS.
            index = await buildMp4Index(vf.file, { prebuiltMoov, probeBytes: 0 });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn("mp4 index build failed", { file: vf.file.name, err: message });
            return null;
        }

        // Run the marker probe lazily - only when no exclusive structural GPS
        // signal already decided the format (embeddedGpsProbeNeeded). When it
        // does run, the index ends up byte-identical to the previous
        // unconditional 4 MB probe, so the extractor walk and its ordering
        // invariants are unchanged for every probe-dependent format. Remember
        // whether we skipped it - the no-winner retry below depends on it.
        const probeSkipped = !embeddedGpsProbeNeeded(index);
        if (!probeSkipped) {
            await probeMarkers(vf.file, index, DEFAULT_PROBE_BYTES);
        }

        let outcome = await classifyAndWalk(vf, index);

        // No-winner probe retry. embeddedGpsProbeNeeded returns false as soon as
        // ANY track/atom looks structural (sbtl/text track, gpmd sample format,
        // free-gps box, ...), assuming that signal exclusively owns the file's
        // GPS. But a file can pair such a track with probe-dependent GPS - a
        // table-less streaming freeGPS clip that also muxes a speed-overlay
        // text/subtitle track, or a clone whose gpmd track is empty. There the
        // marker was never read, every probe-keyed marker returns false, and the
        // walk finds no winner - yielding zero GPS with no error, no skip trace.
        // If the walk came up empty AND we skipped the probe, read it once now
        // and re-walk; the retry costs one bounded probe read and only in the
        // no-winner case (a found winner or an already-run probe never reaches
        // here). See the dispatch-gate desync class that shipped the maiGpsBox
        // regression (__fixtures__/dispatch-gate.test.ts).
        if (outcome === null && probeSkipped) {
            await probeMarkers(vf.file, index, DEFAULT_PROBE_BYTES);
            outcome = await classifyAndWalk(vf, index);
        }
        return outcome;
    };

    const workers = Array.from({ length: Math.min(concurrency, workItems.length) }, async () => {
        while (cursor < workItems.length) {
            if (signal?.aborted) return;
            const idx = cursor++;
            const item = workItems[idx]!;
            const candidates = [item.primary, ...item.followers];

            let result: ParseResult | null = null;
            let usedCandidate: ClassifiedFile | null = null;
            let deferred = false;
            for (const cand of candidates) {
                const r = await tryParseOne(cand.file);
                if (r === "heavy-deferred") {
                    for (const c of candidates) heavyFiles.push(c);
                    deferred = true;
                    break;
                }
                if (r) {
                    result = r;
                    usedCandidate = cand;
                    break;
                }
            }

            if (!deferred && result && usedCandidate) {
                // extendArray, not push(...): one long embedded GPS stream can
                // exceed the call-argument limit the spread form would hit.
                extendArray(allRecords, result.records);
                extendArray(allSkipped, result.skipped);
                used.add(result.extractorId);
                winningExtractorByFilename.set(usedCandidate.file.file.name, result.extractorId);
                if (result.videoStartUtcHint !== undefined) {
                    videoStartUtcHintByFilename.set(usedCandidate.file.file.name, result.videoStartUtcHint);
                }
                if (result.localClockOffsetHintSec !== undefined) {
                    localClockOffsetHintByFilename.set(usedCandidate.file.file.name, result.localClockOffsetHintSec);
                }
                if (result.accelSamples && result.accelSamples.length > 0) {
                    accelByFilename.set(usedCandidate.file.file.name, result.accelSamples);
                }
                for (const cand of candidates) {
                    if (cand === usedCandidate) continue;
                    const followerName = cand.file.file.name;
                    for (const rec of result.records) {
                        allRecords.push({ ...rec, mp4Filename: followerName });
                    }
                    winningExtractorByFilename.set(followerName, result.extractorId);
                    // cloneAcrossGroup means followers are byte-synchronized
                    // with the primary, so they share media-time 0 wall-clock -
                    // and, for the same reason, the same accel stream.
                    if (result.videoStartUtcHint !== undefined) {
                        videoStartUtcHintByFilename.set(followerName, result.videoStartUtcHint);
                    }
                    // Byte-synchronized followers share the primary's clock,
                    // so the local-stamp evidence transfers verbatim.
                    if (result.localClockOffsetHintSec !== undefined) {
                        localClockOffsetHintByFilename.set(followerName, result.localClockOffsetHintSec);
                    }
                    if (result.accelSamples && result.accelSamples.length > 0) {
                        accelByFilename.set(followerName, result.accelSamples);
                    }
                }
            }

            // Report progress per FILE, not per work item: a cloneAcrossGroup
            // item (Juscar F/R) covers several files, so counting work items
            // stalls the overlay (e.g. a 2-file group at "1/1" reads as ~50%).
            // Sum of candidates across all items == videos.length by construction.
            for (const cand of candidates) {
                done++;
                if (onProgress) onProgress(done, videos.length, cand.file);
            }
        }
    });
    await Promise.all(workers);
    if (signal?.aborted) throw new DOMException("ingest aborted", "AbortError");

    return {
        appliedExtractors: [...used],
        records: allRecords,
        skipped: allSkipped,
        errors,
        winningExtractorByFilename,
        videoStartUtcHintByFilename,
        localClockOffsetHintByFilename,
        accelByFilename,
        heavyFiles,
    };
}

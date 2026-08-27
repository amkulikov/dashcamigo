// Groups video files into trips by time gap.
// Deterministic: input is an array of video metadata, output is an array of
// trips. The one input mutation is the session-drift pass (writes
// candidate.driftLeadSec, see channel-drift.ts) - it resets before measuring
// and derives only from the candidates, so regrouping is idempotent.

import { applyChannelDriftLead } from "./channel-drift.js";
import { detectEvents, type TripEvent } from "./events.js";
import { detectInferredSegments, type InferredSegment } from "./inferred-events.js";
import {
    accelMagnitude,
    dropTeleportOutliers,
    firstSyncedRecord,
    lastSyncedRecord,
    totalDistanceKm,
} from "./parser.js";
import type { GpsRecord, Channel, RecordingMode, VendorFile } from "./parsers/types.js";
import type { VideoCodec } from "mediabunny";
import type { Mp4Rotation } from "./indexer.js";
import { createLogger } from "./log.js";

const log = createLogger("trips");

/**
 * Source of startUtc for a specific file. Priority (most to least accurate):
 *   "embedded" - wall-clock of media-time 0 reported by the GPS extractor itself
 *             (e.g. RVMI tReV OLE-date). Authoritative when present: the
 *             primitive ties absolute UTC to media-time 0, no inference needed.
 *             Survives container quirks like fragment-of-original-MP4 where
 *             mvhd.creation_time refers to the parent file, not this clip.
 *   "mp4"   - mvhd.creation_time from container, corrected for camera TZ.
 *             Accurate to the second, reflects actual recording start (not the
 *             first GPS record which may arrive 5-10s later due to GPS fix delay).
 *             Falls back to "gps" if TZ cannot be estimated, or to "mp4 as-is"
 *             (risky - may be off by hours with local-as-UTC mvhd semantics).
 *   "gps"   - first GPS record for this MP4. Last-resort anchor for a file that
 *             HAS GPS: used only when no named claim (mvhd/filename) places the
 *             GPS window correctly. Less accurate by N seconds where N = GPS fix
 *             delay after recording start, which on a cold start reaches tens of
 *             seconds - hence the named claims are tried first.
 *   "name"  - time from filename (vendor-specific format), the camera's own clock
 *             (filename = t=0). For a camera without usable mvhd (70mai) this is
 *             the PRIMARY anchor: filename minus the run-measured precise clock
 *             offset (GPS only measured the offset). It outranks "gps" because it
 *             carries no per-file cold-start lag. The lone-clip fallback instead
 *             self-calibrates and is window-validated like mvhd.
 *   "mtime" - File.lastModified - durationSec. Last resort. mtime is a FS
 *             metadata field overwritten by any touch/cp/trim, so it cannot be
 *             trusted as absolute recording time. Shown as unreliable in the UI.
 */
export type StartSource = "embedded" | "gps" | "mp4" | "name" | "mtime";

// Classifier ids (from filename/index.ts) that recognised the filename.
// null means no classifier matched for that field.
export interface ClassifierMatches {
    time: string | null;
    channel: string | null;
    mode: string | null;
    sequence: string | null;
}

// Video candidate for grouping.
export interface VideoCandidate {
    file: File;
    // Path from the selected folder root. Empty string if file was picked without
    // directory structure. Used by classifiers for path-based heuristics.
    relativePath: string;
    // Source scope copied from VendorFile. Together with path + metadata it
    // distinguishes reused paths and equal directory trees inside a session.
    sourceKey?: string;
    // Stable camera key (see camera-fingerprint.ts). Used for trip-grouping
    // and per-fingerprint TZ heuristics. Replaces the old vendorId.
    fingerprint: string;
    // Extractor ids that produced GPS records for this file. Empty if the
    // file has no GPS (or has not been parsed yet). Surfaced in diagnostics;
    // the UI does not use it. Usually 1-2 entries (1 video-embedded + maybe
    // 1 sidecar).
    appliedExtractors: string[];
    // Which classifiers (by id from filename/index.ts) recognised the
    // filename. null means no classifier matched - the value came from a
    // default or fallback. Diagnostics-only; the UI does not use it.
    classifierMatches: ClassifierMatches;
    // Channel for multi-camera dashcam (front/rear/interior). null for single-
    // channel models and plugins without detectChannel.
    channel: Channel | null;
    // Whether `channel` was recognised from a trustworthy signal (mnemonic
    // letter under a vendor-specific pattern, spelled-out path, or single
    // channel) vs guessed from an index letter (CarCam A/B/C/D, Vantrue A/B/C).
    // false when channel is null. Drives whether the UI shows the semantic
    // label ("Rear camera") or a positional one ("Channel N"). See ChannelMatch.
    channelConfident: boolean;
    // Sequence number from filename - tiebreaker in groupTrips when startUtc
    // values are equal. null means stable sort by startUtc only.
    sequence: number | null;
    // Recording mode (Normal/Event/Parking/Manual). null if plugin doesn't know
    // or the format doesn't distinguish.
    recordingMode: RecordingMode | null;
    // Time-lapse recording (camera captured frames slower than playback, so the
    // clip is time-compressed and its clock does not track real elapsed time).
    // Filename-derived (classifyFilenameTimelapse); orthogonal to recordingMode.
    // Drives the sidebar time-lapse chip and the "clock is not real-time" marker.
    isTimelapse: boolean;
    // unix seconds (UTC) of recording start
    startUtc: number;
    // mp4 duration (from indexer.ts)
    durationSec: number;
    // Real-world (wall-clock) span the clip covers when it differs from the
    // video duration - i.e. for time-lapse clips (a 6.5 s LA clip covering 98
    // real seconds). null = realtime (wall span == durationSec). Derived from
    // per-file evidence in deriveWallDurationSec; drives the wall-scaled
    // timeline segments, gap math and unsynced-record spreading.
    wallDurationSec: number | null;
    // How many seconds this file's CONTENT is ahead of its nominal timestamps
    // (frame-count-cut muxers with schedule-derived names drift about a second
    // per hour - see channel-drift.ts). Consumers that fetch this channel's
    // content (export segment placement, slave-channel playback sync) shift the
    // file this much later on the content axis; the nominal axis itself -
    // startUtc, frame grouping, timeline, GPS - never moves. null = no
    // correction (single-channel, healthy camera, or an unmeasurable session).
    driftLeadSec: number | null;
    startSource: StartSource;
    // Camera-clock zone for DISPLAY: snapshot of the per-fingerprint
    // filenameTzSec estimate (see displayTzSec for the invariant it feeds).
    // null when the fleet produced no filename/GPS pair for this camera.
    // Deliberately NOT mvhdTzSec-backed: honest-UTC-mvhd firmware yields 0
    // there and would flip the display from the viewer's zone to raw UTC.
    cameraTzSec: number | null;
    // Per-file evidence that this file's GPS record clocks are the camera's
    // LOCAL wall time (zone baked in): the extractor's cold-start clock-jump
    // measurement (ParsedRecords.localClockOffsetHintSec). A parse-time
    // constant - never recomputed. Aggregated per fingerprint and applied to
    // the record axis by applyLocalClockCorrections; null = no evidence in
    // this file (most files - only a clip that catches the GPS fix mid-file
    // can measure the jump).
    localClockOffsetHintSec: number | null;
    // mvhd.creation_time as Date (interpreted as UTC directly). Stored in the
    // candidate so startUtc can be recalculated after camera TZ is refined
    // from the complete set of indexed recordings.
    createdUtc: Date | null;
    // GPS points for this MP4 (may be empty)
    records: GpsRecord[];
    // codec of primary video track (from indexer). null if undetermined;
    // canPlay is then optimistically true.
    codec: VideoCodec | null;
    // FourCC sample-entry of the primary video track ('avc1' / 'hvc1' / 'hev1' /
    // 'av01' / 'vp09'), or null (TS / undetermined). Diagnostics-only (attach
    // log, feedback report). The full RFC 6381 string with profile/level lives
    // in videoCodecString.
    codecParam: string | null;
    // Full RFC 6381 codec string when derivable ("hev1.2.4.L153", from hvcC for
    // HEVC MP4 / getCodecParameterString for TS). null for AVC MP4 or when
    // undetermined. Feeds the config-aware canPlay check so HEVC Main10 / a
    // too-high level the browser cannot decode is caught - the bare codec enum
    // makes mediabunny assume a decodable generic Main profile.
    videoCodecString: string | null;
    // MP4 display-matrix rotation. Passed to export so the output MP4
    // opens in the correct orientation.
    rotation: Mp4Rotation;
    // Technical metadata for the sidebar's per-clip details panel (see
    // ui/file-details.ts). fps also drives frame stepping and re-encode timing;
    // null while metadata is pending or when no video track is measurable.
    width: number | null;
    height: number | null;
    fps: number | null;
    audio: { codec: string | null; channels: number; sampleRate: number } | null;
    // Whether the browser can decode this file's codec. Computed in batch
    // after ingest via canDecodeVideo (mediabunny, memoized). false means
    // playFile shows an overlay instead of a black <video>.
    canPlay: boolean;
    // True if the file needs MSE remux before playback, i.e. native
    // <video>.src=URL.createObjectURL(File) produces a black screen. True for
    // HEVC files with sample entry hev1 (BlackVue ELITE 9 / Vantrue N2X) or
    // with invalid NAL arrays in hvcC (BlackVue ELITE 9 firmware padding).
    // Propagated from Mp4Index during ingest. Handled in playFrame:
    // true = per-file MSE via hevc-remux.ts; false = regular <video>.src.
    needsHevcRemux: boolean;
    // True if the container is MPEG-TS (.ts/.m2ts). MPEG-TS is not natively
    // decodable by <video> in Chromium/Firefox, so playback is forced through
    // PerFileMseBackend, which uses mediabunny to remux to fragmented MP4 on
    // the fly. Decision is by filename only (see video-formats.ts) - set in
    // ingest.ts when the VideoCandidate is built.
    isTransportStream: boolean;
    // True if the container is Matroska (.mkv). Like MPEG-TS, Matroska is not
    // natively decodable by <video>.src in any target browser, so playback is
    // forced through PerFileMseBackend (mediabunny remuxes to fragmented MP4).
    // Decision is by filename only - set when the VideoCandidate is built.
    isMatroska: boolean;
    // True if the audio track is IMA ADPCM (Mio/Navman MiVue), which no browser
    // decodes natively - the file would play with silent audio on the native
    // <video> path. Routes playback through PerFileMseBackend, which decodes the
    // ADPCM and re-encodes it to an MSE-playable codec on the fly while
    // stream-copying the video. Propagated from IndexedMp4 during ingest. See
    // requiresMseBackend.
    audioNeedsTranscode: boolean;
    // Absolute UTC of video frame 0, when the GPS extractor itself can tie it
    // (e.g. RVMI tReV baseline). null when unknown - deriveStartUtc then falls
    // back to mvhd/firstGps/etc. See ParsedRecords.videoStartUtcHint.
    embeddedStartUtcHint: number | null;
    // False while byte-derived recording metadata is pending: durationSec is an
    // estimate and codec/container fields are placeholders. Undefined or true
    // means ready, preserving compatibility with cached candidates that predate
    // this explicit state. See needsRecordingMetadata.
    metadataReady?: boolean;
    // Terminal failure of the mandatory metadata read. The scheduler must not
    // retry it within the same ingest run; the closing commit removes it from the
    // playable trip list and reports the file as unreadable.
    metadataFailed?: boolean;
}

/**
 * Whether mandatory byte-derived metadata is still pending. Ready and terminally
 * failed candidates are both complete from the scheduler's perspective.
 */
export function needsRecordingMetadata(candidate: VideoCandidate): boolean {
    return candidate.metadataReady === false && candidate.metadataFailed !== true;
}

/**
 * Frame - a set of synchronized files for one trip moment across channels
 * (front + rear + interior for three-channel models). Single-channel models
 * have exactly one channel ("front") per frame.
 *
 * Contract:
 *   - `startUtc` = canonical channel startUtc (front > rear > interior > side > any).
 *     This is the **real** wall-clock time of the canonical channel's first frame,
 *     not snapped. Multi-channel grouping into one frame uses a snap key inside
 *     groupTrips, but frame.startUtc itself stays real-time. Other channels'
 *     startUtc may differ by 0.x sec due to different startSource.
 *   - `durationSec` = max(channel.startUtc + channel.durationSec) - frame.startUtc.
 *     Frame spans as long as any channel is recording; end = end of the longest
 *     channel, duration measured from canonical startUtc.
 *   - 'front' is NOT required. If the front file is lost/corrupt, the frame may
 *     contain only rear and/or interior. Active channel is selected by priority
 *     front -> rear -> interior with fallback to any present channel.
 */
export interface TripFrame {
    startUtc: number;
    durationSec: number;
    // Real-world span the frame covers; == durationSec except for time-lapse
    // clips (VideoCandidate.wallDurationSec). Gap/overlap math and the
    // content<->wall projections use THIS; durationSec stays the footage
    // (video) length that the player/scrubber/export live on.
    wallDurationSec: number;
    channels: Partial<Record<Channel, VideoCandidate>>;
}

/**
 * One contiguous footage span on the content-time axis. A trip with N frames
 * has N segments laid back-to-back with NO gaps between them: pauses in the
 * recording are removed from the content axis and surfaced as TripGap dividers
 * instead. `contentStart` is the footage-second where the frame begins,
 * `wallStart` its real UTC - the pair is what wallToContentSec / contentToWallUtc
 * interpolate across.
 */
export interface ContentSegment {
    contentStart: number;
    contentEnd: number;
    wallStart: number;
    durationSec: number;
    // Wall-clock span of the segment: == durationSec for realtime footage,
    // larger for a time-lapse frame (its content second covers
    // wallDurationSec/durationSec real seconds). The projections interpolate
    // with that ratio so the clock/marker/chart track real time through a
    // sped-up clip.
    wallDurationSec: number;
    frameIndex: number;
}

/**
 * A recording pause between two frames, positioned on the content axis. The
 * divider sits at `contentPos` (= end of the preceding segment); `durationSec`
 * is the real wall-clock length of the pause (what "pause N min" shows).
 */
export interface TripGap {
    contentPos: number;
    wallStart: number;
    durationSec: number;
}

/**
 * Footage-time view of a trip. The content axis is the sum of frame durations
 * with pauses removed - this is the single coordinate system the player
 * scrubber, chart, export range and playhead all live on. Physical time
 * (GpsRecord.unixSeconds, frame.startUtc, GPSU stamps, filenames) stays
 * wall-clock UTC and is crossed only through the projection functions below
 * (wallToContentSec / contentToWallUtc / contentToFrame).
 *
 * PLAIN DATA on purpose: the timeline rides on Trip, and Trip is structured-
 * cloned across the transcode worker boundary (postMessage). Methods/closures
 * would throw DataCloneError, so the projectors are free functions taking the
 * timeline as their first argument rather than instance methods.
 */
export interface TripTimeline {
    // sum of frame durations, gaps removed - the content-axis length
    contentDurationSec: number;
    segments: ContentSegment[];
    gaps: TripGap[];
}

// A trip is a sequence of consecutive frames.
export interface Trip {
    frames: TripFrame[];
    // start of the first frame
    startUtc: number;
    // end of the last frame
    endUtc: number;
    // endUtc - startUtc (including possible micro-gaps between frames). This is
    // the WALL-CLOCK span; for the footage-time axis used by the UI and export
    // use `timeline.contentDurationSec`. Kept for the title/end-time display.
    durationSec: number;
    // Footage-time projection of the frames - the coordinate system shared by
    // player/chart/export-range. Rebuilt whenever frames change (finalizeTrip).
    timeline: TripTimeline;
    // sum of all file sizes across all channels, in bytes
    totalBytes: number;
    // total GPS distance in km (0 if no points)
    distanceKm: number;
    // concatenation of records from all files on all channels, sorted by
    // unixSeconds, deduped by (unixSeconds, lat, lon). Dedup is unnecessary
    // for 70mai (GPS only on front), but guards against duplicates if a future
    // vendor writes GPS on multiple channels simultaneously.
    records: GpsRecord[];
    // Presentation-time GPS calibration. Candidate.records and state.gpsLog
    // always keep the parser's original timestamps; this derived Trip view may
    // shift them so every consumer (map, chart, events and export) sees one
    // synchronized clock. Optional keeps cached/test Trip literals compatible.
    gpsOffsetSec?: number;
    // When true, the derived records view omits points outside actual footage
    // wall-clock spans. False preserves the historical full-route behavior.
    gpsTrimToVideo?: boolean;
    // auto-detected events (brakes, turns, stops)
    events: TripEvent[];
    // Inferred ranged signals (stop / brake / turn / accel) derived from
    // speed and bearing. Used by the chart strip to render colored bars under
    // the timeline. Empty when records.length < 2.
    inferredSegments: InferredSegment[];
    // True when the trip is a parking session: at least one frame is
    // parking-class (see frameTripClass). The mode-class split in groupTrips
    // guarantees a trip never mixes parking-class and driving-class frames,
    // so "any" equals "all class-defining". Drives the sidebar "P" badge.
    isParking: boolean;
    // Channels whose semantic mount is trusted across the whole trip - a
    // channel is here only if EVERY file on it was confidently classified.
    // Channels present in the trip but absent from this set are shown as
    // positional "Channel N" (their letter->mount mapping is a vendor
    // convention we can't verify). See VideoCandidate.channelConfident.
    confidentChannels: Set<Channel>;
    // Camera-clock zone for DISPLAY, lifted from the trip's candidates (one
    // fingerprint per trip - the grouping key - so any non-null value is THE
    // camera's). Plain data on purpose: rides through structuredClone to the
    // transcode worker for the burned-in overlay clock. See displayTzSec.
    cameraTzSec: number | null;
    // First-frame preview of the first MP4 in the trip (JPEG dataURL).
    // Filled in background during ingest (see ui/trip-preview.ts) - does not
    // block ingest. Stays undefined if the decoder failed (corrupt codec / no
    // primary video track); sidebar shows the dark placeholder instead.
    previewDataUrl?: string;
}

/**
 * Standard channel priority for selecting the active channel. Matches the
 * "driver usually looks forward" expectation, with fallback in descending order.
 * If none of these channels are present in the frame, pick any available.
 */
const CHANNEL_PRIORITY: readonly Channel[] = ["front", "rear", "interior", "side"];

/**
 * Active VideoCandidate in a frame for the requested channel. Falls back through
 * CHANNEL_PRIORITY if the requested channel is absent (e.g. user selected rear
 * but only front exists), then to any present channel. Returns null only for an
 * empty frame (should not happen in practice).
 */
export function pickFrameChannel(
    frame: TripFrame,
    preferred: Channel,
): { candidate: VideoCandidate; channel: Channel } | null {
    const exact = frame.channels[preferred];
    if (exact) return { candidate: exact, channel: preferred };
    for (const ch of CHANNEL_PRIORITY) {
        const c = frame.channels[ch];
        if (c) return { candidate: c, channel: ch };
    }
    const entries = Object.entries(frame.channels) as Array<[Channel, VideoCandidate]>;
    const first = entries[0];
    return first ? { candidate: first[1], channel: first[0] } : null;
}

/**
 * Orders a set of present channels: CHANNEL_PRIORITY first (front, rear,
 * interior, side), then any leftover channels in their original iteration
 * order. Shared by frameChannels and tripChannels so the ordering rule has one
 * definition.
 */
function orderChannels(present: Iterable<Channel>): Channel[] {
    const set = present instanceof Set ? present : new Set(present);
    const ordered: Channel[] = [];
    for (const ch of CHANNEL_PRIORITY) {
        if (set.has(ch)) ordered.push(ch);
    }
    for (const ch of set) {
        if (!ordered.includes(ch)) ordered.push(ch);
    }
    return ordered;
}

/**
 * Channels present in a frame in stable UI order (front, rear, interior).
 * Channels outside CHANNEL_PRIORITY (if ever added) appear at the end in
 * insertion order.
 */
export function frameChannels(frame: TripFrame): Channel[] {
    return orderChannels(Object.keys(frame.channels) as Channel[]);
}

/**
 * All channels present across all frames in a trip (union). Used for the
 * sidebar badge and the channel selector in the export modal.
 */
export function tripChannels(trip: Trip): Channel[] {
    const seen = new Set<Channel>();
    for (const frame of trip.frames) {
        for (const ch of Object.keys(frame.channels) as Channel[]) seen.add(ch);
    }
    return orderChannels(seen);
}

/**
 * All VideoCandidates in a trip, ordered by frame then by channel within each frame.
 * Replaces the old `trip.files` for code that needs to iterate all files
 * (aggregates, codec checks).
 */
export function tripAllCandidates(trip: Trip): VideoCandidate[] {
    const out: VideoCandidate[] = [];
    for (const frame of trip.frames) {
        for (const ch of frameChannels(frame)) {
            const c = frame.channels[ch];
            if (c) out.push(c);
        }
    }
    return out;
}

/**
 * VideoCandidates for a specific channel in frame order. Used in playback
 * (sequential single-channel playback across frames) and in export
 * (mediabunny concatenation per channel). Frames without this channel are
 * skipped - playback and export both omit them.
 */
export function tripCandidatesByChannel(trip: Trip, channel: Channel): VideoCandidate[] {
    const out: VideoCandidate[] = [];
    for (const frame of trip.frames) {
        const c = frame.channels[channel];
        if (c) out.push(c);
    }
    return out;
}

/**
 * If the gap between the end of the current file and the start of the next is
 * at most this value, the files belong to the same trip. Otherwise a new trip starts.
 *
 * 30 seconds covers: typical file close/open overhead on SD card (1-2s),
 * small mp4 duration / mtime inaccuracies, and hour-boundary crossings. Real
 * pauses between trips are much larger: the driver shuts off the engine, the
 * dashcam stops recording, and the next file only appears at the next power-on.
 */
const TRIP_GAP_THRESHOLD_SEC = 30;

// User-configurable override. localStorage["dashcamigo:trips:gapSec"] can
// override the default; UI exposes presets (5min / 15min / 60min / off=Infinity).
// "off" stores Number.POSITIVE_INFINITY worth of seconds (we serialize as the
// literal string "off" to keep JSON-parseable).
const STORAGE_KEY_TRIP_GAP = "dashcamigo:trips:gapSec";

/** Current gap threshold in seconds, or +Infinity for "never split into trips". */
export function getTripGapSec(): number {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_TRIP_GAP);
        if (raw === null) return TRIP_GAP_THRESHOLD_SEC;
        if (raw === "off") return Number.POSITIVE_INFINITY;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) return n;
    } catch {
        // private mode - fall through to default.
    }
    return TRIP_GAP_THRESHOLD_SEC;
}

/**
 * Persists the gap threshold. Accepts a finite positive number of seconds,
 * or `Number.POSITIVE_INFINITY` for "off" (never split into separate trips).
 * A 0-second threshold means "split on every gap" which is never useful, so
 * we clamp the minimum to 1 second.
 */
export function setTripGapSec(sec: number): void {
    try {
        if (!Number.isFinite(sec)) {
            localStorage.setItem(STORAGE_KEY_TRIP_GAP, "off");
        } else {
            localStorage.setItem(STORAGE_KEY_TRIP_GAP, String(Math.max(1, Math.floor(sec))));
        }
    } catch {
        // private mode - choice won't survive reload but works in this session.
    }
}

/**
 * Snap startUtc to a coarse grid for frame grouping. Synchronized channels
 * of a multi-channel dashcam start "simultaneously", but real startUtc values
 * can diverge:
 *  - 70mai-mc F/B: different startSource (F got GPS-first, B got mvhd+vendor-tz)
 *    diverge by 1-2s.
 *  - CARCAM 4CH A/B/C/D: channels resolving different sources (GPS-first vs
 *    filename-time) diverged by 1-2s before the fleet clock-offset anchor
 *    made them symmetric; D also runs an independent sequence counter. The
 *    tolerance stays: any camera where siblings resolve different sources
 *    can reproduce the same 1-2s skew.
 *
 * Snap grid = 30s with Math.round-half-up: the effective snap radius is 15s.
 * Two adjacent clips on the same channel collide only if their startUtc values
 * differ by less than 15s. Real dashcam clips (including parking mode) are
 * 20s+, so collisions don't happen in practice. The dup1/dup2 channel-conflict
 * fallback below still handles them safely if they ever do.
 */
const FRAME_TIMESTAMP_SNAP_SEC = 30;

/**
 * Default channel for files with null channel. Used when a plugin does not
 * return a channel (single-channel models like x800) - files go to "front"
 * as the most natural default.
 */
const DEFAULT_CHANNEL: Channel = "front";

/**
 * Wall-clock overlap (seconds) between two consecutive normal-mode clips of one
 * fingerprint that flips the trip-walk from "merge" to "split". One camera
 * cannot record two overlapping clips on a single channel, so a real overlap
 * means two distinct sessions whose timestamps collide - a clock reset, or two
 * physically identical cameras that hash to the same fingerprint (camera-key
 * strips the folder, so same-model units in different dumps are indistinguishable).
 *
 * Set above the few-second startUtc jitter between adjacent clips (a contiguous
 * run routinely derives startUtc from different sources per file - mvhd on one,
 * GPS-first on the next - and durationSec is rounded) and well below a real
 * collision, which overlaps by a full clip length (60s+). Only positive overlap
 * beyond this triggers a split; smaller overlaps stay one trip.
 */
const OVERLAP_SPLIT_TOLERANCE_SEC = 15;

/**
 * Provisional clip duration used before the moov is read. groupTrips
 * splits trips on `gap = next.startUtc - (prev.startUtc + prev.durationSec)`, so
 * a missing duration makes the gap walk meaningless. We feed a synthetic
 * durationSec = the camera's own modal inter-clip spacing; contiguous segments
 * then give gap ~= 0 and a real engine-off pause still stands out. Replaced by
 * the true durationSec on metadata read, which triggers a regroup.
 */
const PROVISIONAL_DEFAULT_SEC = 60;
// Clamp band for the estimate. A too-small value only UNDERshoots (gap stays a
// small positive < threshold, clips stay merged - safe); a too-large value can
// OVERshoot into a spurious overlap-split. So the band is tight on the high end
// and the mode tie-break below leans small.
const PROVISIONAL_MIN_SEC = 1;
const PROVISIONAL_MAX_SEC = 600;

/**
 * Estimates a provisional clip duration per camera fingerprint from filename
 * start times alone, without reading file bytes.
 *
 * Per fingerprint: sort the candidates' startUtc, collapse clips recorded at the
 * same instant into one "moment" (multi-channel F+R+I share a startUtc within a
 * few tenths of a second - the SAME_MOMENT window is FRAME_TIMESTAMP_SNAP_SEC/2,
 * the exact "same moment" tolerance groupTrips' boundary-rescue uses), then take
 * the mode of the inter-moment deltas. Collapsing first is mandatory: without it
 * F+R+I inject 0-deltas whose mode is 0. We do NOT snap the delta itself to the
 * 30s grid - that would quantize a 100s segment into alternating 90/120 deltas
 * and the 120 overshoot would split a contiguous run. Engine-off pauses (delta >
 * MAX) are excluded so they do not define the segment length; ties break toward
 * the smaller delta because overshoot is the only dangerous direction.
 *
 * Returns fingerprint -> provisional durationSec (clamped to [MIN, MAX]). A
 * fingerprint with a single distinct moment has no delta and gets the default.
 */
interface ProvisionalTimingCandidate {
    fingerprint: string;
    startUtc: number;
    /** Optional classifier evidence. Supplying it lets the estimator tell two
     *  adjacent short clips on one camera apart from simultaneous cameras. */
    channel?: Channel | null;
    sequence?: number | null;
}

export function estimateProvisionalDurationByFingerprint(
    candidates: ReadonlyArray<ProvisionalTimingCandidate>,
): Map<string, number> {
    const startsByFingerprint = new Map<string, ProvisionalTimingCandidate[]>();
    for (const candidate of candidates) {
        let starts = startsByFingerprint.get(candidate.fingerprint);
        if (!starts) {
            starts = [];
            startsByFingerprint.set(candidate.fingerprint, starts);
        }
        starts.push(candidate);
    }

    const sameMomentSec = FRAME_TIMESTAMP_SNAP_SEC / 2;
    const result = new Map<string, number>();
    for (const [fingerprint, starts] of startsByFingerprint) {
        starts.sort((a, b) => a.startUtc - b.startUtc);
        // Distinct moments: a clip more than sameMomentSec after the previous
        // moment starts a new one. Within the window it is another channel of the
        // same instant (real adjacent single-channel clips are 60s+ apart).
        const moments: Array<{
            startUtc: number;
            channels: Set<Channel>;
            sequences: Set<number>;
            hasIdentity: boolean;
        }> = [];
        for (const candidate of starts) {
            const last = moments[moments.length - 1];
            const channel = candidate.channel ?? DEFAULT_CHANNEL;
            const hasIdentity = candidate.channel !== undefined || candidate.sequence !== undefined;
            const withinWindow = last !== undefined && candidate.startUtc - last.startUtc <= sameMomentSec;
            // Filename classifiers distinguish the ambiguous short-clip case:
            // another file on an already-occupied channel is the NEXT moment even
            // when it starts inside the broad cross-channel snap window. Distinct
            // channels (or an explicitly shared sequence) are simultaneous.
            const canJoinByIdentity =
                last !== undefined &&
                (candidate.sequence !== null &&
                candidate.sequence !== undefined &&
                last.sequences.has(candidate.sequence)
                    ? true
                    : !last.channels.has(channel));
            // Time-only callers collapse every candidate inside the snap window;
            // progressive ingest supplies classifier fields for finer grouping.
            const sameMoment = withinWindow && (canJoinByIdentity || (!hasIdentity && !last!.hasIdentity));
            if (!sameMoment) {
                moments.push({
                    startUtc: candidate.startUtc,
                    channels: new Set([channel]),
                    sequences:
                        candidate.sequence !== null && candidate.sequence !== undefined
                            ? new Set([candidate.sequence])
                            : new Set(),
                    hasIdentity,
                });
                continue;
            }
            last!.channels.add(channel);
            if (candidate.sequence !== null && candidate.sequence !== undefined) {
                last!.sequences.add(candidate.sequence);
            }
            last!.hasIdentity ||= hasIdentity;
        }
        // Mode of inter-moment deltas, rounded to whole seconds (collapses sub-
        // second timescale jitter). Sorted distinct moments are strictly
        // increasing, so deltas are positive - no negative-jitter poisoning.
        const deltaCounts = new Map<number, number>();
        for (let i = 1; i < moments.length; i++) {
            const delta = Math.round(moments[i]!.startUtc - moments[i - 1]!.startUtc);
            if (delta < PROVISIONAL_MIN_SEC || delta > PROVISIONAL_MAX_SEC) continue;
            deltaCounts.set(delta, (deltaCounts.get(delta) ?? 0) + 1);
        }
        let bestDelta = PROVISIONAL_DEFAULT_SEC;
        let bestCount = 0;
        for (const [delta, count] of deltaCounts) {
            if (count > bestCount || (count === bestCount && delta < bestDelta)) {
                bestDelta = delta;
                bestCount = count;
            }
        }
        result.set(fingerprint, Math.min(PROVISIONAL_MAX_SEC, Math.max(PROVISIONAL_MIN_SEC, bestDelta)));
    }
    return result;
}

/**
 * Groups candidates into trips. Two-pass algorithm:
 *
 *  1. Candidates are grouped into frames by key `(fingerprint, snappedStartUtc,
 *     sequence)`. One frame = one trip moment across channels. If a file would
 *     go into a frame where that channel is already taken, a new frame is created
 *     (guards against duplicates and anomalies).
 *  2. Frames are sorted by startUtc and split into trips at gaps larger than
 *     TRIP_GAP_THRESHOLD_SEC between frame end and next frame start, and at
 *     every driving<->parking mode-class transition (frameTripClass) - a
 *     parking time-lapse walls the engine-off pause with its wallDurationSec,
 *     so without the class split a whole day of drives and parking sessions
 *     glues into one trip.
 *
 * Sequence (counter from filename) is a tiebreaker and the mc-pairing key:
 * on 70mai-mc, synchronized F/B files share the same counter so they
 * deterministically land in the same frame. Single-channel models without
 * sequence degrade to timestamp-only key - each file gets its own frame.
 */
export function groupTrips(videos: VideoCandidate[], gapSec: number = getTripGapSec()): Trip[] {
    if (videos.length === 0) return [];

    // Stable sort by (startUtc, sequence) so equal keys are processed deterministically.
    const sorted = [...videos].sort((a, b) => {
        if (a.startUtc !== b.startUtc) return a.startUtc - b.startUtc;
        const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
        const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
        return aSeq - bSeq;
    });

    // Step 1: group into frames. Key = `${fingerprint}|t${snapped}`.
    // fingerprint is cross-channel (camera-key library strips channel letter
    // and channel folder from filename / path), so F+R+I of one physical
    // camera share a fingerprint and merge into one frame via the channel
    // logic below. Two distinct cameras dropped together get DIFFERENT
    // fingerprints and stay in separate frames even if their timestamps fall
    // inside the same 30s snap window.
    //
    // Sequence is NOT part of the key:
    //  - 70mai-mc F/B share the same sequence and fall into the same bucket via snap.
    //  - CARCAM 4CH A/B/C/D: D has an independent sequence counter
    //    (515 for D vs 527 for A), so only the timestamp snap groups them.
    //  - Single-channel (70mai x800): adjacent clips 60+ sec apart exceed
    //    the 30s snap boundary, so each file gets its own frame.
    const framesByKey = new Map<string, TripFrame>();
    const frameOrder: string[] = [];
    for (const video of sorted) {
        const channel: Channel = video.channel ?? DEFAULT_CHANNEL;
        // Snap is used ONLY as the grouping key for multi-channel frames:
        // F and B are recorded simultaneously but their startUtc may differ by 0.x sec
        // (different startSource: F used GPS-first, B used mvhd+TZ).
        // Snap to 30s tolerates this. For single-channel, the threshold is inactive:
        // adjacent clips are 60+ sec apart and won't collapse into the same key.
        const snapped = Math.round(video.startUtc / FRAME_TIMESTAMP_SNAP_SEC) * FRAME_TIMESTAMP_SNAP_SEC;
        let key = `${video.fingerprint}|t${snapped}`;

        let existing = framesByKey.get(key);
        // Boundary rescue: simultaneous channels whose startUtc straddle the
        // middle of a snap interval round to ADJACENT buckets (1004.8 -> 990,
        // 1005.2 -> 1020 - a real 1-2 s inter-channel delta, see CARCAM note
        // above) and would silently split into two single-channel frames. When
        // the exact bucket is empty, probe the two neighbour buckets for a
        // same-fingerprint frame whose anchor is within half a snap interval -
        // the actual "same moment" tolerance the snap exists to express.
        // Single-channel clips are safe: the channel slot is already taken
        // and adjacent clips are 60+ s apart anyway (> SNAP/2).
        if (!existing) {
            for (const delta of [-FRAME_TIMESTAMP_SNAP_SEC, FRAME_TIMESTAMP_SNAP_SEC]) {
                const neighborKey = `${video.fingerprint}|t${snapped + delta}`;
                const neighbor = framesByKey.get(neighborKey);
                if (
                    neighbor &&
                    !neighbor.channels[channel] &&
                    Math.abs(video.startUtc - neighbor.startUtc) <= FRAME_TIMESTAMP_SNAP_SEC / 2
                ) {
                    key = neighborKey;
                    existing = neighbor;
                    break;
                }
            }
        }

        // If a frame exists for this key and the channel is taken, create a new
        // frame. This is an anomaly (two F files with the same timestamp+sequence)
        // but shouldn't be fatal.
        if (existing?.channels[channel]) {
            let suffix = 1;
            while (framesByKey.get(`${key}|dup${suffix}`)?.channels[channel]) suffix++;
            key = `${key}|dup${suffix}`;
            existing = framesByKey.get(key);
        }
        if (!existing) {
            existing = {
                // Temporarily use this channel's startUtc/durationSec; final values
                // are recalculated after grouping in finalizeFrameTiming - which picks
                // canonical (front-priority) startUtc and max-end across channels.
                // The snapped value is NOT used as frame.startUtc: snap to 30s grid
                // caused a bug where the chart was shifted 0..15s from the scrubber
                // because trip.startUtc (snapped) diverged from real GPS timestamps.
                startUtc: video.startUtc,
                durationSec: video.durationSec,
                wallDurationSec: video.wallDurationSec ?? video.durationSec,
                channels: {},
            };
            framesByKey.set(key, existing);
            frameOrder.push(key);
        }
        existing.channels[channel] = video;
    }
    // Recalculate canonical startUtc and durationSec from real channel values.
    for (const f of framesByKey.values()) {
        finalizeFrameTiming(f);
    }

    // Step 2: frames → trips. Partition by fingerprint FIRST, then split each
    // partition by gap/overlap. A trip is one physical camera's continuous run:
    // two cameras dropped together (different recorders, or different dumps of
    // one recorder) get different fingerprints and never share a trip, even when
    // their footage overlaps in wall-clock time. The bug this fixes was a single
    // global gap-walk that sorted ALL frames by time and glued frames of two
    // overlapping recorders into one interleaved trip. Channels of one camera
    // share a fingerprint (camera-key strips the channel marker), so F+R+I stay
    // together. Folder is deliberately NOT a grouping signal: channel and
    // recording mode live in the path (Normal/Front, RecentClips/...), so a
    // folder split would tear one trip apart along its own mode/channel subdirs.
    const framesByFingerprint = new Map<string, TripFrame[]>();
    for (const k of frameOrder) {
        const frame = framesByKey.get(k)!;
        // All candidates in a frame share a fingerprint (it is part of the frame
        // key), so any present channel answers for the whole frame.
        const fingerprint = frameCanonicalCandidate(frame)?.fingerprint ?? "";
        let group = framesByFingerprint.get(fingerprint);
        if (!group) {
            group = [];
            framesByFingerprint.set(fingerprint, group);
        }
        group.push(frame);
    }

    const trips: Trip[] = [];
    for (const group of framesByFingerprint.values()) {
        group.sort((a, b) => a.startUtc - b.startUtc);
        // Session-drift pass BEFORE the trip split: a recording session may span
        // trip boundaries (driving<->parking class split), and the tail-pair
        // measurement needs the whole per-camera chain. See channel-drift.ts.
        applyChannelDriftLead(group);
        let current: TripFrame[] = [group[0]!];
        // Gap is measured from the furthest end reached by ANY frame in the
        // current trip, not just the last-appended frame. Frames are sorted by
        // startUtc, but a frame that starts later can END earlier: a short
        // event/parking copy (protected mid-loop) sorts after the 60s normal clip
        // it overlaps yet finishes before it. Measuring the gap from that shorter
        // frame's end would see a phantom pause and split a continuous trip.
        // Wall spans, not content durations: a time-lapse frame's video is a
        // few seconds but its recording covers minutes - gap math on the video
        // length would see a phantom pause right after every time-lapse clip.
        let maxEndUtc = group[0]!.startUtc + group[0]!.wallDurationSec;
        // Mode class of the trip being built - set by its first class-defining
        // frame (sticky event/manual/unknown frames leave it null until one
        // arrives).
        let currentClass = frameTripClass(group[0]!);
        for (let i = 1; i < group.length; i++) {
            const prev = current[current.length - 1]!;
            const next = group[i]!;
            const gap = next.startUtc - maxEndUtc;
            // Three reasons to start a new trip within one camera:
            //  - a real pause (engine off): a positive gap over the threshold;
            //  - a wall-clock OVERLAP one camera cannot physically produce on a
            //    channel - overlapping clips mean two sessions with colliding
            //    timestamps (clock reset, or two identical cameras hashing to one
            //    fingerprint). Gated to normal↔normal (or unknown-mode) clips: an
            //    event/parking clip is often a protected COPY of a moment also in
            //    the normal loop, so it overlaps by design and must stay put;
            //  - a driving<->parking class transition: the parking time-lapse
            //    wall span covers the engine-off pause, so the gap test alone
            //    would glue every drive and parking session of the day into one
            //    endless trip. Only class-DEFINING frames split (frameTripClass
            //    != null on both sides): an event fired while parked stays in
            //    the parking session, one fired on the road stays in the drive.
            //
            // Overlap stays a per-pair test on the ADJACENT (prev, next) frames -
            // it is a physical-impossibility check between two specific clips, not
            // a span measurement, so it must NOT use maxEndUtc.
            const prevOverlap = prev.startUtc + prev.wallDurationSec - next.startUtc;
            const overlapSplit =
                prevOverlap > OVERLAP_SPLIT_TOLERANCE_SEC &&
                isFrameNormalOrUnknown(prev) &&
                isFrameNormalOrUnknown(next);
            const nextClass = frameTripClass(next);
            const classSplit = currentClass !== null && nextClass !== null && nextClass !== currentClass;
            if (gap > gapSec || overlapSplit || classSplit) {
                trips.push(finalizeTrip(current));
                current = [next];
                maxEndUtc = next.startUtc + next.wallDurationSec;
                currentClass = nextClass;
            } else {
                current.push(next);
                const nextEnd = next.startUtc + next.wallDurationSec;
                if (nextEnd > maxEndUtc) maxEndUtc = nextEnd;
                if (currentClass === null) currentClass = nextClass;
            }
        }
        trips.push(finalizeTrip(current));
    }

    // Per-fingerprint walking emits trips grouped by camera; the sidebar and
    // player expect chronological order, so restore the global startUtc sort.
    trips.sort((a, b) => a.startUtc - b.startUtc);
    return trips;
}

// Channel priority for canonical startUtc. Front first - it is the master
// camera on dashcams, GPS typically comes from it, and users orient by front video.
// Side last - only present on 4-channel truck/fleet models, never the primary.
const CANONICAL_CHANNEL_PRIORITY: readonly Channel[] = ["front", "rear", "interior", "side"];

/**
 * Canonical candidate of a frame - the front-priority channel (front > rear >
 * interior > side), falling back to the first present channel. All channels of a
 * frame are the same camera at the same moment, so this one answers for the
 * whole frame: it drives frame.startUtc (finalizeFrameTiming), the frame
 * fingerprint and the frame recording mode (trip-grouping in groupTrips).
 * Returns null only for an empty frame (guard - should not happen).
 */
function frameCanonicalCandidate(frame: TripFrame): VideoCandidate | null {
    for (const ch of CANONICAL_CHANNEL_PRIORITY) {
        const c = frame.channels[ch];
        if (c) return c;
    }
    // Fallback - first declared channel (in case Channel union gains a value
    // not in the priority list).
    for (const c of Object.values(frame.channels)) {
        if (c) return c;
    }
    return null;
}

/**
 * Recording mode of a frame = its canonical (front-priority) candidate's mode.
 * The single notion of "the frame's mode" shared by the sidebar mode chip and
 * the chart's recording-mode bands, so the two never disagree on what a frame
 * is. null when the format does not distinguish mode or the frame is empty.
 */
export function frameRecordingMode(frame: TripFrame): RecordingMode | null {
    return frameCanonicalCandidate(frame)?.recordingMode ?? null;
}

/**
 * Whether a frame's canonical clip is normal driving or has no known mode.
 * Gates the overlap-split in groupTrips: an event/parking/manual clip is often a
 * protected copy that overlaps the normal loop on purpose, so such overlaps must
 * NOT split a trip. An empty frame (no candidate) counts as unknown.
 */
function isFrameNormalOrUnknown(frame: TripFrame): boolean {
    const mode = frameRecordingMode(frame);
    return mode === null || mode === "normal";
}

/**
 * Mode class of a frame for the driving<->parking trip split in groupTrips.
 * "parking" = the background parked loop (parking mode, or a filename-flagged
 * time-lapse - today every isTimelapse format is a parking feature); "driving" =
 * the normal loop. null = the frame does not DEFINE a class and sticks to the
 * surrounding trip: event/manual clips mark an incident, not a loop - a
 * g-sensor capture fired while parked (70mai PA maps to "event") belongs to
 * the parking session it interrupted, one fired on the road to the drive. A
 * camera that reports no mode at all yields null everywhere, so its grouping
 * is untouched.
 */
function frameTripClass(frame: TripFrame): "driving" | "parking" | null {
    const c = frameCanonicalCandidate(frame);
    if (!c) return null;
    if (c.recordingMode === "parking" || c.isTimelapse) return "parking";
    if (c.recordingMode === "normal") return "driving";
    return null;
}

/**
 * Recalculates frame.startUtc, frame.durationSec and frame.wallDurationSec
 * from real channel values.
 * frame.startUtc = startUtc of the first present channel by priority.
 * frame.durationSec = max(channel.startUtc + channel.durationSec) - frame.startUtc.
 * frame.wallDurationSec = same max over the channels' WALL spans
 * (candidate.wallDurationSec ?? durationSec) - differs only on time-lapse frames.
 */
export function finalizeFrameTiming(frame: TripFrame): void {
    const canonical = frameCanonicalCandidate(frame);
    if (!canonical) return; // empty frame - should not happen, guard

    let endUtc = canonical.startUtc + canonical.durationSec;
    let wallEndUtc = canonical.startUtc + (canonical.wallDurationSec ?? canonical.durationSec);
    for (const c of Object.values(frame.channels)) {
        if (!c) continue;
        const e = c.startUtc + c.durationSec;
        if (e > endUtc) endUtc = e;
        const w = c.startUtc + (c.wallDurationSec ?? c.durationSec);
        if (w > wallEndUtc) wallEndUtc = w;
    }
    frame.startUtc = canonical.startUtc;
    frame.durationSec = endUtc - canonical.startUtc;
    frame.wallDurationSec = wallEndUtc - canonical.startUtc;
}

/**
 * Minimum inter-frame gap (seconds) that becomes a visible pause divider.
 * Below this the gap is not a recording the driver paused but measurement noise
 * in the per-file start: adjacent files can derive startUtc from different
 * sources (mvhd on one, GPS-first-record on the next) and durationSec is rounded,
 * so a contiguous run routinely shows a few seconds of drift at each join. A real
 * stop/park pause is on the order of a minute or more, so we coalesce anything
 * below this silently - the content axis stays the concatenated footage with no
 * spurious dividers. (The collapsed-but-undrawn seconds are still removed from
 * the axis; only the divider marker is suppressed.)
 */
const GAP_DIVIDER_MIN_SEC = 60;

/**
 * Builds the footage-time projection for a frame sequence (already sorted by
 * startUtc). Segments are laid back-to-back on the content axis; inter-frame
 * pauses >= GAP_DIVIDER_MIN_SEC become dividers. Pure - no Trip dependency, so
 * it can be unit-tested on raw frames.
 *
 * Mapping contract (kept identical for chart projection and export filtering so
 * they never disagree):
 *  - a record inside a gap clamps to the preceding segment's contentEnd (the
 *    divider) rather than being dropped - dropping leaves a hole in the speed
 *    chart and breaks distance continuity;
 *  - a record before the first frame clamps to 0, after the last to
 *    contentDurationSec;
 *  - on overlapping frames (negative gap) the earliest containing segment wins.
 */
export function buildTripTimeline(frames: readonly TripFrame[]): TripTimeline {
    const segments: ContentSegment[] = [];
    const gaps: TripGap[] = [];
    let cursor = 0;
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        const dur = Math.max(0, frame.durationSec);
        // Wall span is never below the content length (deriveWallDurationSec
        // only ever stretches); clamp defensively so a corrupt frame cannot
        // produce a time-reversing projection.
        const wallDur = Math.max(dur, frame.wallDurationSec);
        const contentStart = cursor;
        const contentEnd = contentStart + dur;
        segments.push({
            contentStart,
            contentEnd,
            wallStart: frame.startUtc,
            durationSec: dur,
            wallDurationSec: wallDur,
            frameIndex: i,
        });
        if (i > 0) {
            const prev = segments[i - 1]!;
            const prevWallEnd = prev.wallStart + prev.wallDurationSec;
            const gapDur = frame.startUtc - prevWallEnd;
            if (gapDur >= GAP_DIVIDER_MIN_SEC) {
                gaps.push({
                    contentPos: contentStart, // == previous segment contentEnd
                    wallStart: prevWallEnd,
                    durationSec: gapDur,
                });
            }
        }
        cursor = contentEnd;
    }
    return { contentDurationSec: cursor, segments, gaps };
}

/** Segment whose footage window contains contentSec (clamped to [0, end]). */
function segmentForContent(timeline: TripTimeline, contentSec: number): ContentSegment | null {
    const { segments, contentDurationSec } = timeline;
    if (segments.length === 0) return null;
    const clamped = Math.max(0, Math.min(contentDurationSec, contentSec));
    for (const seg of segments) {
        if (clamped < seg.contentEnd) return seg;
    }
    return segments[segments.length - 1]!; // clamped === contentDurationSec
}

/**
 * Projects a wall-clock instant onto the footage axis. A record inside a pause
 * clamps to the preceding divider; before the first / after the last frame
 * clamps to 0 / contentDurationSec. Monotonic non-decreasing in unixSeconds.
 */
export function wallToContentSec(timeline: TripTimeline, unixSeconds: number): number {
    const { segments, contentDurationSec } = timeline;
    if (segments.length === 0) return 0;
    if (unixSeconds <= segments[0]!.wallStart) return 0;
    for (const seg of segments) {
        const wallEnd = seg.wallStart + seg.wallDurationSec;
        if (unixSeconds < wallEnd) {
            // inside this segment, or in the pause before it (clamp to divider)
            if (unixSeconds >= seg.wallStart) {
                // On a time-lapse frame one content second covers several wall
                // seconds - compress by the segment's ratio (1 for realtime).
                const scale = seg.wallDurationSec > 0 ? seg.durationSec / seg.wallDurationSec : 0;
                return seg.contentStart + (unixSeconds - seg.wallStart) * scale;
            }
            return seg.contentStart;
        }
    }
    return contentDurationSec;
}

/** Footage second -> absolute UTC of that moment (skips paused time; runs at
 *  the frame's time-lapse rate through a sped-up clip). */
export function contentToWallUtc(timeline: TripTimeline, contentSec: number): number {
    const seg = segmentForContent(timeline, contentSec);
    if (!seg) return 0;
    const clamped = Math.max(0, Math.min(timeline.contentDurationSec, contentSec));
    const scale = seg.durationSec > 0 ? seg.wallDurationSec / seg.durationSec : 1;
    return seg.wallStart + (clamped - seg.contentStart) * scale;
}

/**
 * Footage second -> frame index + offset within that frame's video. The caller
 * resolves the TripFrame via trip.frames[index] (the timeline is plain data and
 * does not carry frame references, so it can cross a worker boundary).
 * Clamps a past-the-end value to the last frame's end.
 */
export function contentToFrame(timeline: TripTimeline, contentSec: number): { index: number; offsetInFrame: number } {
    const seg = segmentForContent(timeline, contentSec);
    if (!seg) return { index: 0, offsetInFrame: 0 };
    const clamped = Math.max(0, Math.min(timeline.contentDurationSec, contentSec));
    return { index: seg.frameIndex, offsetInFrame: Math.max(0, clamped - seg.contentStart) };
}

/**
 * Turns a frame array into a Trip with aggregates. Exported for incremental
 * refreshes where records, timing or events changed but membership did not.
 */
export { finalizeTrip as finalizeTripFromFrames };

function finalizeTrip(frames: TripFrame[]): Trip {
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;

    const { records, mergedCount } = collectRawTripRecords(frames);
    if (records.length !== mergedCount) {
        log.debug("teleport outliers dropped from trip", {
            dropped: mergedCount - records.length,
            kept: records.length,
        });
    }

    let totalBytes = 0;
    for (const frame of frames) {
        for (const ch of frameChannels(frame)) {
            const c = frame.channels[ch];
            if (c) totalBytes += c.file.size;
        }
    }
    const distanceKm = totalDistanceKm(records);

    const startUtc = first.startUtc;
    // Wall spans (not content durations), and a max over ALL frames: a
    // time-lapse frame covers far more real time than its video length, and
    // an earlier long frame can end after the last-starting one.
    let endUtc = last.startUtc + last.wallDurationSec;
    for (const frame of frames) {
        const frameEnd = frame.startUtc + frame.wallDurationSec;
        if (frameEnd > endUtc) endUtc = frameEnd;
    }
    const timeline = buildTripTimeline(frames);

    // A channel is trusted only if every file on it was confidently classified.
    // One guessed file demotes the whole channel to a positional label, so the
    // UI never mixes "Rear camera" and "Camera 2" for the same mount.
    const confidentChannels = new Set<Channel>();
    const guessedChannels = new Set<Channel>();
    for (const frame of frames) {
        for (const [ch, c] of Object.entries(frame.channels) as Array<[Channel, VideoCandidate]>) {
            if (c.channelConfident) confidentChannels.add(ch);
            else guessedChannels.add(ch);
        }
    }
    for (const ch of guessedChannels) confidentChannels.delete(ch);

    // The mode-class split keeps parking-class and driving-class frames in
    // separate trips, so one parking-class frame marks the whole trip.
    const isParking = frames.some((f) => frameTripClass(f) === "parking");

    // One fingerprint per trip (the grouping key), so the first non-null
    // estimate is the camera's - no cross-camera disagreement to arbitrate.
    let cameraTzSec: number | null = null;
    outer: for (const frame of frames) {
        for (const ch of frameChannels(frame)) {
            const c = frame.channels[ch];
            if (c && c.cameraTzSec !== null) {
                cameraTzSec = c.cameraTzSec;
                break outer;
            }
        }
    }

    return {
        isParking,
        frames,
        startUtc,
        endUtc,
        durationSec: endUtc - startUtc,
        timeline,
        totalBytes,
        distanceKm,
        records,
        // Event/inferred positions are chart x-coordinates, so they must live on
        // the footage axis like everything else the chart draws. Detection runs
        // on wall-clock (its duration thresholds need real seconds), then the
        // emitted positions are projected onto the content axis.
        events: projectEventsOntoTimeline(detectEvents(records, startUtc), timeline),
        inferredSegments: projectInferredOntoTimeline(detectInferredSegments(records, startUtc), startUtc, timeline),
        confidentChannels,
        cameraTzSec,
    };
}

/** Builds the parser-timestamp view of a trip from unchanged candidate data.
 *  Every GPS calibration starts here, so repeated edits never accumulate
 *  floating-point drift or lose points trimmed by the previous value. */
function collectRawTripRecords(frames: readonly TripFrame[]): { records: GpsRecord[]; mergedCount: number } {
    // Records from all channels in all frames. Dedup by (unixSeconds, lat, lon)
    // guards against duplicates if a vendor writes GPS on multiple channels
    // simultaneously (on 70mai GPS is only on front, so no duplicates by design).
    // frameChannels iterates in CHANNEL_PRIORITY order (front first), so front's
    // record wins its identity on a collision - but a camera with per-channel IMU
    // can carry the impact spike on the lower-priority channel, so transplant the
    // stronger accel triple onto the survivor (max-|G| wins) instead of dropping
    // it before detectEvents. Clone, never mutate: candidate.records are reused
    // across regroups. indexByKey holds the survivor's slot in the pre-sort array.
    const indexByKey = new Map<string, number>();
    const merged: GpsRecord[] = [];
    for (const frame of frames) {
        for (const ch of frameChannels(frame)) {
            const c = frame.channels[ch];
            if (!c) continue;
            for (const r of c.records) {
                const key = `${r.unixSeconds}|${r.lat}|${r.lon}`;
                const existingIdx = indexByKey.get(key);
                if (existingIdx === undefined) {
                    indexByKey.set(key, merged.length);
                    merged.push(r);
                    continue;
                }
                const kept = merged[existingIdx]!;
                if (
                    accelMagnitude(r.accelXg, r.accelYg, r.accelZg) >
                    accelMagnitude(kept.accelXg, kept.accelYg, kept.accelZg)
                ) {
                    merged[existingIdx] = { ...kept, accelXg: r.accelXg, accelYg: r.accelYg, accelZg: r.accelZg };
                }
            }
        }
    }
    merged.sort((a, b) => a.unixSeconds - b.unixSeconds);

    // Teleport/spike filter MUST run right here: after the sort (it walks an
    // anchor chain over time-ordered records) and before totalDistanceKm /
    // detectEvents (event.recordIndex points into trip.records, so filtering
    // later would shift indices under the events). finalizeTrip is the single
    // funnel for everything user-visible (map track, marker interpolation,
    // chart, distance, events, export), and it recomputes on every regroup -
    // candidate records and state.gpsLog keep the raw parser output.
    return { records: dropTeleportOutliers(merged), mergedCount: merged.length };
}

/** Original, unshifted GPS records for a derived trip. Returns a fresh array;
 *  record objects themselves remain parser-owned and are never mutated. */
export function rawTripGpsRecords(trip: Trip): GpsRecord[] {
    return collectRawTripRecords(trip.frames).records;
}

interface WallInterval {
    start: number;
    end: number;
}

/** Merges overlapping footage wall spans so trimming is O(records + clips),
 *  including cameras whose protected/event clips overlap the normal loop. */
function footageWallIntervals(timeline: TripTimeline): WallInterval[] {
    const intervals: WallInterval[] = [];
    for (const seg of timeline.segments) {
        const start = seg.wallStart;
        const end = start + seg.wallDurationSec;
        const last = intervals[intervals.length - 1];
        if (last && start <= last.end) {
            if (end > last.end) last.end = end;
        } else {
            intervals.push({ start, end });
        }
    }
    return intervals;
}

function trimGpsRecordsToFootage(records: GpsRecord[], timeline: TripTimeline): GpsRecord[] {
    const intervals = footageWallIntervals(timeline);
    if (intervals.length === 0 || records.length === 0) return [];
    const out: GpsRecord[] = [];
    let intervalIndex = 0;
    for (const record of records) {
        while (intervalIndex < intervals.length && record.unixSeconds > intervals[intervalIndex]!.end) {
            intervalIndex++;
        }
        const interval = intervals[intervalIndex];
        if (!interval) break;
        if (record.unixSeconds >= interval.start && record.unixSeconds <= interval.end) out.push(record);
    }
    return out;
}

/** Rebuilds every GPS-derived Trip aggregate from the original candidate
 *  records, with one presentation-time offset. Positive values move the track
 *  later in the video. This mutates only the derived Trip object. */
export function applyGpsSyncToTrip(trip: Trip, offsetSec: number, trimToVideo: boolean): void {
    const normalized = Number.isFinite(offsetSec) ? Math.round(offsetSec * 1000) / 1000 : 0;
    const raw = rawTripGpsRecords(trip);
    const shifted =
        normalized === 0 ? raw : raw.map((record) => ({ ...record, unixSeconds: record.unixSeconds + normalized }));
    const records = trimToVideo ? trimGpsRecordsToFootage(shifted, trip.timeline) : shifted;
    trip.records = records;
    trip.gpsOffsetSec = normalized;
    trip.gpsTrimToVideo = trimToVideo;
    trip.distanceKm = totalDistanceKm(records);
    trip.events = projectEventsOntoTimeline(detectEvents(records, trip.startUtc), trip.timeline);
    trip.inferredSegments = projectInferredOntoTimeline(
        detectInferredSegments(records, trip.startUtc),
        trip.startUtc,
        trip.timeline,
    );
}

/**
 * Re-projects detected brake events onto the footage (content) axis. Their
 * `relSec` is the chart x-position; detection produced it as wall-clock-relative,
 * so it is recomputed from the absolute `unixSeconds` via the trip timeline.
 * An event inside a recording pause clamps to the divider (wallToContentSec).
 */
export function projectEventsOntoTimeline(events: TripEvent[], timeline: TripTimeline): TripEvent[] {
    return events.map((e) => ({ ...e, relSec: wallToContentSec(timeline, e.unixSeconds) }));
}

/**
 * Re-projects inferred segments onto the footage axis. detectInferredSegments
 * emits start/end as wall-clock-relative seconds (= unixSeconds - tripStartUtc),
 * so we reconstruct the absolute UTC and project it. Duration thresholds were
 * already applied in wall-clock during detection - this only moves the bars.
 */
function projectInferredOntoTimeline(
    segments: InferredSegment[],
    tripStartUtc: number,
    timeline: TripTimeline,
): InferredSegment[] {
    return segments.map((s) => ({
        ...s,
        startRelSec: wallToContentSec(timeline, tripStartUtc + s.startRelSec),
        endRelSec: wallToContentSec(timeline, tripStartUtc + s.endRelSec),
    }));
}

// Parameters for estimateTzByFingerprint. A sample may carry pseudoUtc from the
// filename (mvhdNaiveUnix=null), mvhd.creation_time read as unix seconds
// (interpreted as UTC), or both - both provide pairs for estimation.
// At least one of the two must be non-null.
export interface TzSample {
    file: VendorFile;
    fingerprint: string;
    firstGpsUnix: number;
    // mvhd.creation_time read as unix seconds WITHOUT interpretation
    // (treating QuickTime spec as UTC). Dashcams typically store local-as-UTC,
    // so this gives the same delta as filename-time.
    mvhdNaiveUnix: number | null;
    // Clip duration when already known (indexed candidates), null before the
    // moov is read. Used only to chain samples into recording runs for the
    // precise clock offset (estimatePreciseClockOffsetByFingerprint) - the
    // 15-min TZ estimate does not need it.
    durationSec: number | null;
}

/**
 * Per-fingerprint TZ estimate, split by pseudo-time source. The split exists
 * because the two sources can carry DIFFERENT offsets on one camera: firmware
 * that writes mvhd.creation_time in true UTC while naming files in local time
 * is a real combination, and a mixed median over [0,0,…,TZ,TZ,…] lands on
 * TZ/2 - garbage for both consumers. deriveStartUtc picks the matching field
 * for the branch it is in (mvhd correction vs filename correction).
 */
export interface FingerprintTzEstimate {
    /** Snapped median of (filename local time - first GPS fix), or null when
     *  no file of this camera yielded a parseable filename time. */
    filenameTzSec: number | null;
    /** Snapped median of (mvhd.creation_time read as naive UTC - first GPS
     *  fix), or null when no file of this camera carried mvhd. */
    mvhdTzSec: number | null;
}

/** Snap grid for TZ estimates: 15 minutes. Quarter-hour zones are real
 *  (Nepal +5:45, Chatham +12:45, Eucla +8:45) - a 30-minute grid misses
 *  them by 15 minutes. */
const TZ_SNAP_SEC = 900;

/**
 * Seconds to ADD to a stored UTC timestamp so that rendering the sum via UTC
 * accessors (Intl with timeZone:"UTC", getUTC*) shows the wall clock the UI
 * should display: the camera's own clock when the per-fingerprint estimate is
 * known, the browser zone otherwise.
 *
 * WHY the camera clock needs no firmware detection: an honest-UTC camera's
 * estimate is its real zone; local-as-UTC firmware (zone baked into the GPS
 * timestamps) yields estimate 0 with startUtc already carrying the zone -
 * either way unix+offset reproduces the clock the camera showed on its OSD.
 * With no estimate the per-instant browser offset preserves the previous
 * behavior exactly, including DST transitions in the viewer's zone.
 *
 * Known limit: the estimate is one median per fingerprint, so a dump spanning
 * the camera's own clock change (DST re-sync) displays the minority cluster
 * shifted by that hour - same exposure the no-GPS anchors already have.
 */
export function displayTzSec(unixSec: number, cameraTzSec: number | null): number {
    return cameraTzSec ?? -new Date(unixSec * 1000).getTimezoneOffset() * 60;
}

/**
 * A Date whose UTC fields carry the display wall clock for `unixSec` (see
 * displayTzSec). Read it ONLY via getUTC* or Intl with timeZone:"UTC" -
 * local accessors would apply the browser zone a second time.
 */
export function displayClockDate(unixSec: number, cameraTzSec: number | null): Date {
    return new Date((unixSec + displayTzSec(unixSec, cameraTzSec)) * 1000);
}

/** Median of `deltas` snapped to the TZ grid; null for an empty list.
 *  Mutates (sorts) the input - callers pass throwaway buckets.
 *
 *  Never averages the two middle values on an even count: on a bimodal bucket
 *  (a camera clock change mid-dump - DST on local-as-UTC firmware shifts deltas
 *  by exactly 3600s) the average lands halfway between the two clusters (e.g.
 *  tz+1800), a value belonging to NEITHER, which survives the 15-min snap and
 *  throws every no-GPS sibling channel 30 min off its GPS-bearing front. Mirrors
 *  the guard in estimatePreciseClockOffsetByFingerprint: take an OBSERVED lower
 *  median as a provisional center, drop deltas more than an hour from it, then
 *  take the lower median of the survivors. */
function snappedMedianTz(deltas: number[]): number | null {
    if (deltas.length === 0) return null;
    deltas.sort((a, b) => a - b);
    // Lower median (an observed element), not the midpoint average - see above.
    const center = deltas[(deltas.length - 1) >> 1]!;
    // The center itself always survives (distance 0), so this is never empty.
    const survivors = deltas.filter((d) => Math.abs(d - center) <= CLOCK_OFFSET_OUTLIER_BOUND_SEC);
    const median = survivors[(survivors.length - 1) >> 1]!;
    return Math.round(median / TZ_SNAP_SEC) * TZ_SNAP_SEC;
}

/**
 * Estimates the camera TZ offset SEPARATELY FOR EACH fingerprint. Returns
 * `Map<fingerprint, FingerprintTzEstimate>`.
 *
 * Per-fingerprint rather than a single global median: in mixed ingests
 * (70mai from one TZ + NMEA sidecar from another) a global median would
 * lock onto the larger group's TZ and yield a large error for the other.
 * Grouping by fingerprint isolates each camera.
 *
 * Estimation within a group: median of `(pseudoUtc - firstGpsUnix)` deltas
 * across all file pairs for this fingerprint, kept per source (filename vs
 * mvhd - see FingerprintTzEstimate for why they must not be mixed).
 *
 * parseFilenameLocalTime - callback that walks the global FILENAME_TIME
 * classifiers and returns the first non-null match. Independent of
 * fingerprint - it only takes the file itself.
 */
export function estimateTzByFingerprint(
    samples: TzSample[],
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): Map<string, FingerprintTzEstimate> {
    const filenameDeltas = new Map<string, number[]>();
    const mvhdDeltas = new Map<string, number[]>();
    const push = (map: Map<string, number[]>, fingerprint: string, delta: number): void => {
        let bucket = map.get(fingerprint);
        if (!bucket) {
            bucket = [];
            map.set(fingerprint, bucket);
        }
        bucket.push(delta);
    };
    for (const { file, fingerprint, firstGpsUnix, mvhdNaiveUnix } of samples) {
        const localDate = parseFilenameLocalTime(file);
        if (localDate !== null) {
            push(filenameDeltas, fingerprint, localDate.getTime() / 1000 - firstGpsUnix);
        }
        if (mvhdNaiveUnix !== null) {
            push(mvhdDeltas, fingerprint, mvhdNaiveUnix - firstGpsUnix);
        }
    }
    const out = new Map<string, FingerprintTzEstimate>();
    const fingerprints = new Set([...filenameDeltas.keys(), ...mvhdDeltas.keys()]);
    for (const fingerprint of fingerprints) {
        const filenameTzSec = snappedMedianTz(filenameDeltas.get(fingerprint) ?? []);
        const mvhdTzSec = snappedMedianTz(mvhdDeltas.get(fingerprint) ?? []);
        if (filenameTzSec === null && mvhdTzSec === null) continue;
        out.set(fingerprint, { filenameTzSec, mvhdTzSec });
    }
    return out;
}

/** Min files of one RUN needed to trust its precise clock offset. A lone
 *  clip's (filename - firstGps) cannot separate the clock offset from that clip's
 *  GPS cold-start lag; a second chained clip (warm GPS, near-zero lag) reveals
 *  the offset. Runs below this are not emitted - their files inherit a
 *  neighboring run's offset (resolvePreciseClockOffsetForFile) or fall to
 *  deriveStartUtc's per-file path. */
const PRECISE_OFFSET_MIN_FILES = 2;

/** Extra gap (seconds) allowed between a clip's name-time-plus-duration and the
 *  next clip's name time before the chain breaks into a new run. Covers clip
 *  boundary jitter and bridges a single sample hole mid-run (a clip whose GPS
 *  rows are missing contributes no sample, doubling the apparent gap for the
 *  common 60s loop length). Kept below real parked gaps (minutes+), where the
 *  RTC may have drifted or resynced. */
const RUN_CHAIN_SLACK_SEC = 90;

/** Chain ceiling when a sample's duration is not yet known (pre-index pass,
 *  moov unread). Generous enough to cover the longest common loop lengths
 *  (10-min chapters); the post-index sweep (rederiveStartUtcForCandidates)
 *  re-chains with real durations, so this only shapes the provisional runs. */
const RUN_CHAIN_FALLBACK_GAP_SEC = 900;

/** Max name-time distance (seconds) at which a file without a trusted run of
 *  its own may inherit a neighboring run's offset. Dashcam RTC drifts on the
 *  order of ~1-2s/day, so 48h keeps the inherited error near the
 *  GPS_WINDOW_TOLERANCE_SEC scale; a staler offset is worse than the per-file
 *  self-calibration fallback in deriveStartUtc. */
const OFFSET_INHERIT_MAX_GAP_SEC = 48 * 3600;

/**
 * One contiguous recording run of a camera: samples whose name times chain
 * (next within prev + duration + RUN_CHAIN_SLACK_SEC). The unit over which the
 * camera's RTC-vs-GPS offset is constant enough to share: within a run the RTC
 * cannot drift measurably and the camera never rebooted (no resync), while
 * across a multi-day card the offset wanders by tens of seconds - one MAX over
 * the whole card anchored every other session wrong by the spread.
 */
export interface ClockOffsetRun {
    /** Name-clock time of the run's first GPS-bearing sample (naive unix sec). */
    startNameUnix: number;
    /** Name-clock time of the run's last GPS-bearing sample (naive unix sec). */
    endNameUnix: number;
    /** The run's RTC offset: guarded MAX of (filenameNaive - firstGps) over the
     *  run's samples - see estimatePreciseClockOffsetByFingerprint. */
    offsetSec: number;
}

/** Max distance (seconds) a per-file (filename - firstGps) delta may sit from the
 *  fingerprint median before it is treated as a corrupt outlier and excluded from
 *  the precise-offset MAX. A real RTC drift + cold-start lag is seconds-to-minutes;
 *  one hour is far above that yet far below the gross corruptions (wrong-decoded
 *  GPS time, misparsed filename, 1970/2040 stamps) that would otherwise drag the
 *  whole camera's anchor. */
const CLOCK_OFFSET_OUTLIER_BOUND_SEC = 3600;

/**
 * Estimates each camera's PRECISE filename-clock offset from GPS, in seconds,
 * PER RECORDING RUN, keyed by fingerprint (runs sorted by start). Unlike
 * estimateTzByFingerprint (15-min-snapped, for the no-GPS branch), this keeps
 * full precision: it is the camera RTC's exact offset from GPS, used to place
 * t=0 without that file's GPS cold-start lag - so the filename can be the
 * primary anchor (see deriveStartUtc).
 *
 * Per RUN, not per camera-for-the-whole-card: the RTC offset is only constant
 * while the camera stays powered and un-resynced. On a card spanning days the
 * offset drifts by seconds-to-tens-of-seconds between sessions; a single MAX
 * over all files picks the largest historical offset and mis-anchors every
 * other session by the spread (chart/map data visibly lagging the camera's
 * burnt-in overlay). Runs are chained by name time: the next sample continues
 * the run when its name time is within prev + duration + RUN_CHAIN_SLACK_SEC
 * (RUN_CHAIN_FALLBACK_GAP_SEC when the duration is not yet known).
 *
 * Within a run the estimator is MAX, not median, and the reason is physical:
 *   (filenameNaive - firstGps) = clockOffset - coldStartLag,   coldStartLag >= 0
 * because GPS never fixes before recording starts. So every file UNDER-states the
 * offset by its own lag; the file with the smallest lag (warmest GPS - any clip
 * after the first in a continuous run) reveals the true offset, and the max picks
 * it. A median would bake in the typical cold-start lag and shift every start.
 *
 * A run needs PRECISE_OFFSET_MIN_FILES samples (corroboration); smaller runs
 * are not emitted - their files inherit a neighbor via
 * resolvePreciseClockOffsetForFile. firstGps comes from each sample's
 * firstSyncedRecord, which excludes only cold-start placeholder rows - NOT a
 * synced row whose decoded GPS time is wrong-early, nor a misparsed filename.
 * Either would inflate the raw MAX and drag the whole run early. Two guards, no
 * reliance on the later (spatial, post-grouping) teleport filter: (1) HERE,
 * deltas more than CLOCK_OFFSET_OUTLIER_BOUND_SEC from the run median are
 * dropped before the max, so one absurd row cannot win; (2) at USE,
 * deriveStartUtc re-checks the offset against each GPS file's own window and
 * falls back if it mis-anchors (so a surviving outlier, or two identical units
 * pooled into one fingerprint, is bounded per file).
 */
export function estimatePreciseClockOffsetByFingerprint(
    samples: TzSample[],
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): Map<string, ClockOffsetRun[]> {
    interface OffsetSample {
        nameUnix: number;
        delta: number;
        durationSec: number | null;
    }
    const samplesByFp = new Map<string, OffsetSample[]>();
    for (const { file, fingerprint, firstGpsUnix, durationSec } of samples) {
        const localDate = parseFilenameLocalTime(file);
        if (localDate === null) continue;
        const nameUnix = localDate.getTime() / 1000;
        let bucket = samplesByFp.get(fingerprint);
        if (!bucket) {
            bucket = [];
            samplesByFp.set(fingerprint, bucket);
        }
        bucket.push({ nameUnix, delta: nameUnix - firstGpsUnix, durationSec });
    }

    const out = new Map<string, ClockOffsetRun[]>();
    for (const [fingerprint, fpSamples] of samplesByFp) {
        fpSamples.sort((a, b) => a.nameUnix - b.nameUnix);
        const runs: ClockOffsetRun[] = [];
        let runStart = 0;
        const flushRun = (endExclusive: number): void => {
            const run = fpSamples.slice(runStart, endExclusive);
            runStart = endExclusive;
            if (run.length < PRECISE_OFFSET_MIN_FILES) return;
            // Robust MAX: drop gross outliers (corrupt GPS time / misparsed
            // filename) before taking the max. A real warm-vs-cold lag spread is
            // seconds-to-minutes, so a delta an hour-plus off the run's median is
            // corruption, not a warm clip - excluding it stops one bad row from
            // dragging the run. The median is robust to a single outlier even at
            // n=2..3.
            const sorted = run.map((s) => s.delta).sort((a, b) => a - b);
            const median = sorted[sorted.length >> 1]!;
            let max = Number.NEGATIVE_INFINITY;
            for (const s of run) {
                if (Math.abs(s.delta - median) > CLOCK_OFFSET_OUTLIER_BOUND_SEC) continue;
                if (s.delta > max) max = s.delta;
            }
            if (!Number.isFinite(max)) return;
            runs.push({ startNameUnix: run[0]!.nameUnix, endNameUnix: run[run.length - 1]!.nameUnix, offsetSec: max });
        };
        for (let i = 1; i < fpSamples.length; i++) {
            const prev = fpSamples[i - 1]!;
            const ceiling =
                prev.durationSec !== null ? prev.durationSec + RUN_CHAIN_SLACK_SEC : RUN_CHAIN_FALLBACK_GAP_SEC;
            if (fpSamples[i]!.nameUnix - prev.nameUnix > ceiling) flushRun(i);
        }
        flushRun(fpSamples.length);
        if (runs.length > 0) out.set(fingerprint, runs);
    }
    return out;
}

/**
 * Resolves the precise clock offset for one file from its camera's runs: the
 * run nearest to the file's name time (distance 0 when the name falls inside a
 * run), or null when the file has no parseable name time, the camera has no
 * trusted runs, or the nearest run is further than OFFSET_INHERIT_MAX_GAP_SEC
 * (a staler offset would be worse than deriveStartUtc's per-file fallbacks).
 * Nearest-by-name-time is also what keeps no-GPS sibling channels (rear/
 * interior) on the SAME anchor as their GPS-bearing front twin: the siblings
 * share name times, so they resolve to the same run.
 */
export function resolvePreciseClockOffsetForFile(
    runsByFingerprint: Map<string, ClockOffsetRun[]>,
    fingerprint: string,
    file: VendorFile,
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): number | null {
    const runs = runsByFingerprint.get(fingerprint);
    if (!runs || runs.length === 0) return null;
    const localDate = parseFilenameLocalTime(file);
    if (localDate === null) return null;
    const nameUnix = localDate.getTime() / 1000;
    let best: ClockOffsetRun | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const run of runs) {
        const distance = Math.max(0, run.startNameUnix - nameUnix, nameUnix - run.endNameUnix);
        if (distance < bestDistance) {
            best = run;
            bestDistance = distance;
        }
    }
    if (best === null || bestDistance > OFFSET_INHERIT_MAX_GAP_SEC) return null;
    return best.offsetSec;
}

/**
 * Tolerance for the "GPS window fits inside video window" check. Covers:
 *   - GPS fix delay: first record arrives 0..5s after recording starts
 *     (cold antenna, satellite search). Symmetrically, some GoPro modes
 *     have the first record arriving BEFORE the start (pre-record buffer).
 *   - Clock drift: camera RTC may diverge slightly from GPS clock.
 *   - Duration rounding: mediabunny returns fractional seconds.
 *
 * Previously 10s - too lenient: on HERO MAX max-heromode.mp4
 * (gpmd-track 12.3s for 10.5s video), tolerance=10 swallowed GPS 7.5s
 * outside the video window and mvhd-as-finalize passed sanity-check,
 * discarding half the track. 5s is a physically reasonable ceiling for
 * GPS<->video desync within one camera.
 */
const GPS_WINDOW_TOLERANCE_SEC = 5;

/**
 * Checks whether GPS window [firstGps, lastGps] fits inside video window
 * [startUtc, startUtc+durationSec] with GPS_WINDOW_TOLERANCE_SEC on both edges.
 * Used in deriveStartUtc to choose between mvhd-as-start and mvhd-as-finalize:
 * the correct startUtc is the one where the GPS window actually fits inside the video.
 */
function gpsFitsVideoWindow(firstGpsUnix: number, lastGpsUnix: number, startUtc: number, durationSec: number): boolean {
    return (
        firstGpsUnix >= startUtc - GPS_WINDOW_TOLERANCE_SEC &&
        lastGpsUnix <= startUtc + durationSec + GPS_WINDOW_TOLERANCE_SEC
    );
}

// mvhd finalize-semantics corroboration: (mvhdNaive - filenameNaive) within
// this of durationSec proves the container stamp was written at file CLOSE.
// Real finalize cameras land 0..2 s over (duration rounding + close latency).
const MVHD_FINALIZE_TOLERANCE_SEC = 3;
// A clip must cover at least this many times its video duration before any
// wall-span evidence is believed - below it the "evidence" is ordinary clock
// noise between two stamps, not time compression.
const TIMELAPSE_MIN_FACTOR = 1.5;
// Upper sanity bound for an inferred wall span: a single clip spanning more
// than a day is corrupt evidence (garbage mvhd), not a time-lapse.
const TIMELAPSE_WALL_SPAN_CAP_SEC = 86_400;

/**
 * Real-world (wall-clock) span of a clip, when it provably differs from the
 * video duration. Only a filename-flagged time-lapse clip (isTimelapse) is
 * considered - the flag decides IF, per-file evidence decides HOW MUCH:
 *  - the synced-GPS span of the clip's own records (a 1 Hz track covering the
 *    real seconds), and/or
 *  - mvhd minus the filename time: on finalize-semantics cameras (mvhd
 *    written at file close - 70mai A510) that difference IS the recording's
 *    wall span, and both stamps are the same naive camera clock so the
 *    unknown TZ cancels out.
 * The larger plausible evidence wins (both undershoot or hit exactly, never
 * overshoot). Returns null when the clip is not a time-lapse or no evidence
 * clears the plausibility gates - the caller then treats wall span ==
 * durationSec, i.e. exactly the pre-existing realtime behavior.
 */
export function deriveWallDurationSec(args: {
    isTimelapse: boolean;
    durationSec: number;
    createdUtc: Date | null;
    records: GpsRecord[];
    filenameNaiveSec: number | null;
}): number | null {
    const { isTimelapse, durationSec, createdUtc, records, filenameNaiveSec } = args;
    if (!isTimelapse || !(durationSec > 0)) return null;
    const minSpan = durationSec * TIMELAPSE_MIN_FACTOR;

    let best: number | null = null;
    const firstSynced = firstSyncedRecord(records);
    if (firstSynced) {
        const lastSynced = lastSyncedRecord(records) ?? firstSynced;
        const gpsSpan = lastSynced.unixSeconds - firstSynced.unixSeconds;
        if (gpsSpan >= minSpan && gpsSpan <= TIMELAPSE_WALL_SPAN_CAP_SEC) best = gpsSpan;
    }
    if (createdUtc !== null && filenameNaiveSec !== null) {
        const mvhdSpan = createdUtc.getTime() / 1000 - filenameNaiveSec;
        if (mvhdSpan >= minSpan && mvhdSpan <= TIMELAPSE_WALL_SPAN_CAP_SEC && (best === null || mvhdSpan > best)) {
            best = mvhdSpan;
        }
    }
    return best;
}

// Upper sanity bound for the cadence-derived speed factor. Vendor time-lapse
// modes top out around 1 fps capture played at 30-60 fps (30-60x); 120 leaves
// headroom without accepting a "factor" that is really an overnight recording
// pause between two lapse sessions.
const TIMELAPSE_MAX_CADENCE_FACTOR = 120;

/**
 * Cadence fallback for wall spans: per-fingerprint speed factor of time-lapse
 * clips, derived from the filename-time gaps between consecutive clips.
 *
 * A parking time-lapse clip often carries NO per-file wall-span evidence: no
 * GPS rows are written while parked, and some cameras (70mai A810) write no
 * mvhd creation time - deriveWallDurationSec then returns null, every 60s
 * clip recorded 15 minutes apart looks like a 14-minute pause, and one parked
 * night fragments into dozens of single-clip trips. The one signal such a
 * clip always has is its neighbors: lapse clips are wall-continuous (each
 * starts where the previous ends), so gap-to-next / video duration = the
 * capture speed factor (e.g. 900s / 60s = 15x).
 *
 * Returns fingerprint -> median factor. Median over all consecutive pairs,
 * not per-clip gaps: a real recording pause between two lapse sessions is an
 * outlier gap, and the factor range filter plus the median keep it from
 * inflating the estimate. Only filename-timed time-lapse clips participate;
 * a fingerprint with fewer than two distinct clip times yields nothing.
 * Deltas of naive filename times are TZ-independent, so no startUtc needed.
 */
export function estimateTimelapseCadenceFactors(
    candidates: readonly VideoCandidate[],
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): Map<string, number> {
    // fingerprint -> sorted-later map of distinct clip times. Channels of one
    // frame (F+R) share a filename time; keep one entry per distinct time with
    // the largest video duration among its channels as the gap denominator.
    const byFingerprint = new Map<string, Map<number, number>>();
    for (const c of candidates) {
        if (!c.isTimelapse || !(c.durationSec > 0)) continue;
        const nameLocal = parseFilenameLocalTime({ file: c.file, relativePath: c.relativePath });
        if (nameLocal === null) continue;
        const nameSec = nameLocal.getTime() / 1000;
        let times = byFingerprint.get(c.fingerprint);
        if (!times) {
            times = new Map();
            byFingerprint.set(c.fingerprint, times);
        }
        const prev = times.get(nameSec);
        if (prev === undefined || c.durationSec > prev) times.set(nameSec, c.durationSec);
    }

    const factors = new Map<string, number>();
    for (const [fingerprint, times] of byFingerprint) {
        const sorted = [...times.entries()].sort((a, b) => a[0] - b[0]);
        const ratios: number[] = [];
        for (let i = 0; i + 1 < sorted.length; i++) {
            const [timeSec, durationSec] = sorted[i]!;
            const ratio = (sorted[i + 1]![0] - timeSec) / durationSec;
            if (ratio >= TIMELAPSE_MIN_FACTOR && ratio <= TIMELAPSE_MAX_CADENCE_FACTOR) ratios.push(ratio);
        }
        if (ratios.length === 0) continue;
        ratios.sort((a, b) => a - b);
        // Lower median (an observed element) - same convention as the TZ
        // estimator; on the regular cadence of a real lapse run all ratios are
        // near-identical anyway.
        factors.set(fingerprint, ratios[(ratios.length - 1) >> 1]!);
    }
    return factors;
}

/**
 * Fills wallDurationSec from the cadence factor for every time-lapse candidate
 * that still has none - per-file evidence (deriveWallDurationSec) always wins,
 * so run this AFTER it. Mutates candidates in place. Shared by the rederive
 * sweep and the provisional build, so the initial list and the
 * final regroup bundle lapse runs identically.
 */
export function applyTimelapseCadenceWallSpans(
    candidates: readonly VideoCandidate[],
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): void {
    const cadenceFactors = estimateTimelapseCadenceFactors(candidates, parseFilenameLocalTime);
    if (cadenceFactors.size === 0) return;
    for (const c of candidates) {
        if (c.wallDurationSec !== null || !c.isTimelapse || !(c.durationSec > 0)) continue;
        const factor = cadenceFactors.get(c.fingerprint);
        if (factor !== undefined) {
            c.wallDurationSec = Math.min(c.durationSec * factor, TIMELAPSE_WALL_SPAN_CAP_SEC);
        }
    }
}

// Arguments for deriveStartUtc.
interface DeriveStartUtcArgs {
    file: VendorFile;
    fingerprint: string;
    // mvhd.creation_time (from indexer.ts), may be null
    createdUtc: Date | null;
    durationSec: number;
    // GPS records for this MP4
    records: GpsRecord[];
    // TZ estimate for this fingerprint (from estimateTzByFingerprint.get(fingerprint)).
    // null when no files for this camera carry GPS - the per-fingerprint
    // branches are then skipped and we fall through to the fallbacks below.
    fingerprintTz: FingerprintTzEstimate | null;
    // Filename time parser (walks global FILENAME_TIME classifiers).
    parseFilenameLocalTime: (file: VendorFile) => Date | null;
    // Precise (NOT 15-min-snapped) offset of this camera's filename clock from
    // GPS, in seconds, measured over THIS FILE's recording run (resolved via
    // resolvePreciseClockOffsetForFile from estimatePreciseClockOffsetByFingerprint
    // runs). When present, the filename is the PRIMARY anchor: startUtc =
    // filenameNaive - this, with no per-file GPS window validation - GPS only
    // MEASURED the offset, it does not judge the filename. null for a lone clip
    // with no run to inherit (offset cannot be measured from one file) or a
    // camera with no filename time; the per-file self-calibration is then used
    // instead. See deriveStartUtc.
    preciseFilenameOffsetSec: number | null;
    // Wall-clock of video frame 0 reported by the GPS extractor itself, if it
    // can tie it (RVMI tReV). Highest-priority signal: trusted whenever set,
    // because it skips inference from mvhd/firstGps/filename. null when
    // unknown.
    embeddedStartUtcHint: number | null;
    // Filename-flagged time-lapse clip (VideoCandidate.isTimelapse). Gates the
    // mvhd-minus-filename wall-span reading in the no-GPS branch.
    isTimelapse: boolean;
    // Real wall span when it differs from durationSec (deriveWallDurationSec,
    // time-lapse only). The GPS-window validations use it instead of
    // durationSec - a time-lapse clip's GPS covers its WALL span, and checking
    // it against the video duration would reject every correct anchor.
    wallDurationSec: number | null;
}

/**
 * Determines a file's startUtc by priority (see StartSource).
 *
 * Two regimes, split by whether the file has its own GPS fix:
 *
 * WITH GPS - anchor on the camera's own clock, do not guess. mvhd.creation_time
 * and the filename each NAME the clip's t=0 in the camera's local clock; the
 * first GPS record names t=0 PLUS the fix delay (5-10s warm, tens of seconds on
 * a cold start). So the named claims are the accurate anchors and firstGps is
 * only a fallback - using firstGps as the start desyncs video vs chart and,
 * worse, can push a clip past the trip-gap threshold so it fails to glue to its
 * predecessor. Priority:
 *   1. mvhd candidates (start + finalize) window-validated (gpsFitsVideoWindow),
 *      to resolve their ISOBMFF ambiguity - see mvhdStartCandidates.
 *   2. FILENAME via the run-measured precise clock offset
 *      (preciseFilenameOffsetSec, max over the file's recording run of filename
 *      minus firstGps - see estimatePreciseClockOffsetByFingerprint). This is the
 *      primary anchor for no-mvhd cameras (70mai). GPS only MEASURED the offset;
 *      the only per-file check is a firstGps-inside-clip sanity gate that bounds
 *      a corrupt/pooled offset (NOT the tail - the sidecar tail overshoot is the
 *      bug this fixes). Subtracting a run-constant offset removes THIS file's
 *      cold-start lag, which is what kept a continuous trip glued.
 *   3. Lone clip (no trustworthy run offset): self-calibrate the filename TZ
 *      from this file's own delta to firstGps (snapped to the 15-min grid) and
 *      accept only if the window contains the GPS - rejects a clock drifted by
 *      more than a clip length.
 *   4. firstGps, accepted with its fix-delay error, when nothing named fits.
 *
 * mvhd semantics: start vs finalize. ISOBMFF spec says mvhd.creation_time is
 * "when the moov atom was created". Some cameras write it at the START of
 * recording (70mai), others at FINALIZATION (Vantrue, GoPro) - a durationSec
 * difference. Both are emitted as candidates (start first), so the validator
 * picks the right semantics instead of us guessing the vendor.
 *
 * WITHOUT GPS - no own calibrator, so reuse the camera's estimates,
 * most-trusted first: mvhd + vendor TZ, then mvhd corroborated by the filename
 * and interpreted as the user's local clock, then mvhd as-is, then filename +
 * the run PRECISE offset (so a no-GPS sibling channel lands on the SAME t=0 as
 * its GPS-bearing front sibling - 70mai-mc carries GPS only on the front), then
 * filename + 15-min-snapped vendor TZ, then filename as the user's local clock,
 * then mtime. Per-fingerprint (not global) - a global median locks onto the
 * larger group's TZ in a mixed ingest (70mai + NMEA from another zone) and is
 * wrong for the rest.
 */
/** Snap a (claim - firstGps) delta to the 15-min TZ grid. */
function snapTz(deltaSec: number): number {
    return Math.round(deltaSec / TZ_SNAP_SEC) * TZ_SNAP_SEC;
}

/** Interprets UTC fields as a wall clock in the browser's local zone. */
function localUnixFromNaiveClock(naiveUnixSec: number): number {
    const clock = new Date(naiveUnixSec * 1000);
    return (
        new Date(
            clock.getUTCFullYear(),
            clock.getUTCMonth(),
            clock.getUTCDate(),
            clock.getUTCHours(),
            clock.getUTCMinutes(),
            clock.getUTCSeconds(),
            clock.getUTCMilliseconds(),
        ).getTime() / 1000
    );
}

/**
 * Lazily yields mvhd t=0 candidates for a clip that HAS a GPS fix, for
 * deriveStartUtc to validate against the GPS window. The container creation_time
 * carries a start-vs-finalize ambiguity (some cameras stamp it at recording
 * start - 70mai - others at finalization - Vantrue/GoPro), so BOTH readings are
 * emitted (start first) and the window check picks the one whose window actually
 * contains the GPS. Each self-calibrates its TZ from its own mvhd-minus-firstGps
 * delta, so only the GPS fix delay stays in the residual.
 *
 * The FILENAME is deliberately NOT a candidate here - it is handled separately
 * in deriveStartUtc as the PRIMARY anchor (filename minus the run-measured
 * clock offset), not validated per file against the GPS window. Only mvhd needs
 * the window check, because only mvhd has the start/finalize ambiguity.
 *
 * Ordering: the fleet TZ (per-fingerprint median, when measured) comes FIRST,
 * then the per-file self-calibration. The self-calibrated snap folds THIS clip's
 * GPS residual into snapTz(mvhd - firstGps): the fix delay on a cold start, or a
 * GPS track that ends early (tunnel/garage at the clip end). On a clip longer
 * than half the 15-min grid (>7.5 min - 10-min loop options, GoPro chapters) that
 * residual can cross the 450s snap midpoint and mis-round by a full 900s, tearing
 * the clip ~5 min out of its trip. The fleet median carries no per-file residual,
 * so trying it first pre-empts the mis-snap whenever sibling files measured it;
 * a lone clip (fleetTzSec null) falls straight through to self-calibration.
 *
 * Why still snap each self-calibrated candidate separately instead of one shared
 * TZ: under finalize semantics the raw (mvhd - firstGps) delta folds in
 * durationSec, so deriving start- and finalize-TZ independently keeps the clip
 * length out of the rounding for the semantics each candidate represents.
 *
 * All candidates go through the SAME gpsFitsVideoWindow check in the caller: a
 * wrong fleet TZ is off by a full 900s grid step, far past the 5s window
 * tolerance, so it simply fails and control falls through - never anchors blindly.
 */
function* mvhdStartCandidates(
    createdUtc: Date,
    firstGpsUnix: number,
    durationSec: number,
    fleetTzSec: number | null,
): Generator<{ startUtc: number; source: StartSource }> {
    const mvhdNaive = createdUtc.getTime() / 1000;
    // Fleet TZ first (see above): residual-free, resolves the >7.5min mis-snap.
    if (fleetTzSec !== null) {
        // mvhd as recording start (70mai semantics).
        yield { startUtc: mvhdNaive - fleetTzSec, source: "mp4" };
        // mvhd as file finalization (Vantrue/GoPro): start = mvhd - tz - duration.
        yield { startUtc: mvhdNaive - fleetTzSec - durationSec, source: "mp4" };
    }
    // Per-file self-calibration (lone clip, or the fleet candidates missed the
    // GPS window). mvhd as recording start (70mai semantics).
    yield { startUtc: mvhdNaive - snapTz(mvhdNaive - firstGpsUnix), source: "mp4" };
    // mvhd as file finalization (Vantrue/GoPro semantics): start = mvhd - tz - duration.
    const tzFinalize = snapTz(mvhdNaive - durationSec - firstGpsUnix);
    yield { startUtc: mvhdNaive - tzFinalize - durationSec, source: "mp4" };
}

export function deriveStartUtc({
    file,
    fingerprint: _fingerprint,
    createdUtc,
    durationSec,
    records,
    fingerprintTz,
    parseFilenameLocalTime,
    preciseFilenameOffsetSec,
    embeddedStartUtcHint,
    isTimelapse,
    wallDurationSec,
}: DeriveStartUtcArgs): { startUtc: number; source: StartSource; mvhdRejected?: boolean } {
    // Window span the clip's GPS may legitimately cover: the wall span for a
    // time-lapse clip, the video duration otherwise.
    const windowSpanSec = wallDurationSec ?? durationSec;
    // Cold-start records (timeUnsynced) carry a placeholder clock - using them
    // here threw the file onto 1970. Take the first/last record with a real
    // GPS time; if a file is entirely inside the cold-start window, firstGps is
    // null and we fall through to mvhd / filename below.
    const firstSynced = firstSyncedRecord(records);
    const firstGpsUnix = firstSynced ? firstSynced.unixSeconds : null;

    // 0. Embedded hint - GPS extractor ties wall-clock to media-time 0
    //    directly (RVMI tReV). Skips mvhd inference, which is wrong for
    //    derivative files like RegistratorViewer fragments (they carry the
    //    parent's mvhd.creation_time, so gpsFitsVideoWindow fails and the
    //    code below would fall back to firstGps + GPS-fix delay).
    if (embeddedStartUtcHint !== null) {
        return { startUtc: embeddedStartUtcHint, source: "embedded" };
    }

    // WITH GPS: anchor in priority order. mvhd candidates (start/finalize) are
    // window-validated for their ISOBMFF ambiguity; the filename is the PRIMARY
    // anchor via the fleet-measured precise offset (GPS only measured it, it does
    // not judge the filename - just a per-file firstGps-inside-clip sanity gate);
    // then the lone-clip self-calibrated+validated filename; then firstGps. See
    // mvhdStartCandidates and estimatePreciseClockOffsetByFingerprint.
    if (firstGpsUnix !== null) {
        // lastSyncedRecord (not records[last]) so a synced run that ends with a
        // few trailing unsynced rows still uses a real time for the window end.
        const lastGpsUnix = (lastSyncedRecord(records) ?? firstSynced!).unixSeconds;

        // mvhd first (when present): a precise container creation_time, validated
        // against the GPS window to resolve its start/finalize ambiguity. Does not
        // apply to cameras that write no usable mvhd (70mai) - those fall straight
        // to the filename below.
        if (createdUtc !== null) {
            // Fleet mvhd TZ (per-fingerprint median) disambiguates a long clip
            // whose GPS residual would mis-snap the per-file self-calibration; the
            // window check below still guards a wrong fleet value. See
            // mvhdStartCandidates.
            const fleetTzSec = fingerprintTz?.mvhdTzSec ?? null;
            for (const candidate of mvhdStartCandidates(createdUtc, firstGpsUnix, windowSpanSec, fleetTzSec)) {
                if (gpsFitsVideoWindow(firstGpsUnix, lastGpsUnix, candidate.startUtc, windowSpanSec)) {
                    return candidate;
                }
            }
        }

        // Every mvhd reading missed the GPS window - reported to the caller, which
        // aggregates it per fingerprint (see the tripwire in
        // rederiveStartUtcForCandidates). A container stamp that cannot be
        // reconciled with the track it ships with means one of the two clocks
        // lies about its zone, and the anchors below then silently disagree
        // between GPS-bearing and GPS-less clips of the same drive.
        const mvhdRejected = createdUtc !== null;

        // Filename = the camera's own clock, the PRIMARY anchor. GPS is used only
        // to MEASURE the camera's clock offset across this file's recording run
        // (preciseFilenameOffsetSec), never to validate or reject the filename per
        // file. Subtracting the measured offset places t=0 immune to THIS file's
        // GPS cold-start lag, so it beats firstGps even when the file's own GPS
        // window is shifted by the lag (the bug that split a continuous trip).
        const localDate = parseFilenameLocalTime(file);
        if (localDate !== null) {
            const nameNaive = localDate.getTime() / 1000;
            if (preciseFilenameOffsetSec !== null) {
                const anchored = nameNaive - preciseFilenameOffsetSec;
                // Sanity-gate the fleet offset per file: the FIRST GPS fix must
                // land inside THIS clip. A correct offset places it there (the
                // window now contains the GPS - that is the point); a corrupt
                // offset (an outlier that survived the estimator, or two identical
                // units pooled into one fingerprint) mis-anchors the clip so
                // firstGps falls outside, and we drop to the self-calibrated path.
                // Gate on firstGps ONLY, never the tail: the sidecar log's last
                // record routinely sits a few seconds past the true clip end (the
                // very overshoot this fix exists for), and the tail says nothing
                // about whether t=0 is right.
                if (
                    firstGpsUnix >= anchored - GPS_WINDOW_TOLERANCE_SEC &&
                    firstGpsUnix <= anchored + windowSpanSec + GPS_WINDOW_TOLERANCE_SEC
                ) {
                    return { startUtc: anchored, source: "name", mvhdRejected };
                }
            }
            // No (trustworthy) fleet offset - a lone clip cannot separate a large
            // clock offset from a long GPS lock. Self-calibrate the TZ from this
            // file's own delta and accept only if the window actually contains the
            // GPS - so a filename clock drifted by more than a clip length is
            // rejected.
            const selfCalibrated = nameNaive - snapTz(nameNaive - firstGpsUnix);
            if (gpsFitsVideoWindow(firstGpsUnix, lastGpsUnix, selfCalibrated, windowSpanSec)) {
                return { startUtc: selfCalibrated, source: "name", mvhdRejected };
            }
        }

        // No camera-clock anchor placed the GPS window (no mvhd/filename, or both
        // lied by more than a clip length). firstGps is the only ground truth
        // left; accept its fix-delay error.
        return { startUtc: firstGpsUnix, source: "gps", mvhdRejected };
    }

    // WITHOUT GPS: no calibrator, fall back to per-fingerprint TZ estimates
    // (median over sibling files that had GPS), most-trusted first.
    const filenameLocalDate = parseFilenameLocalTime(file);
    // a) mvhd + per-vendor TZ (mvhd-source estimate - the filename-source one may
    //    carry a different offset on UTC-mvhd firmware, see FingerprintTzEstimate).
    if (createdUtc !== null && fingerprintTz?.mvhdTzSec != null) {
        return { startUtc: createdUtc.getTime() / 1000 - fingerprintTz.mvhdTzSec, source: "mp4" };
    }
    // a2) mvhd finalize semantics, corroborated by the filename clock. Some
    //    cameras stamp creation_time at file CLOSE (70mai A510), so (b) "mvhd
    //    as start" would shift every clip forward by its own length - and glue
    //    each clip's map/chart to the wrong minute. Both stamps are the same
    //    naive camera clock, so their difference is TZ-free evidence:
    //    delta == durationSec (within close-latency rounding) proves finalize
    //    semantics -> start = mvhd - duration (== the filename time, but the
    //    container stamp carries the sub-second precision). The delta >= dur/2
    //    guard keeps start-semantics cameras (delta ~ 0) out for clips shorter
    //    than the tolerance. For a time-lapse clip the same delta is the
    //    recording's real WALL span (>> video duration), which equally proves
    //    the filename is the start.
    if (createdUtc !== null) {
        if (filenameLocalDate !== null) {
            const createdNaiveSec = createdUtc.getTime() / 1000;
            const filenameNaiveSec = filenameLocalDate.getTime() / 1000;
            const delta = createdNaiveSec - filenameNaiveSec;
            if (delta >= durationSec / 2 && Math.abs(delta - durationSec) <= MVHD_FINALIZE_TOLERANCE_SEC) {
                return { startUtc: localUnixFromNaiveClock(createdNaiveSec - durationSec), source: "mp4" };
            }
            // For a time-lapse the same delta is the recording's real WALL
            // span. deriveWallDurationSec already judged exactly this
            // evidence (this branch has no synced GPS, so its GPS arm was
            // excluded and only the mvhd-minus-filename arm could produce a
            // value) - branch on its verdict instead of re-deriving the
            // delta against the same thresholds in a second place.
            if (isTimelapse && wallDurationSec !== null) {
                return { startUtc: localUnixFromNaiveClock(filenameNaiveSec), source: "name" };
            }
            // A same-clock filename proves that mvhd carries camera-local fields
            // despite the UTC-shaped container value. Preserve its finer timing,
            // but interpret those fields in the browser's zone just like the
            // filename-only fallback below. Honest-UTC mvhd paired with a local
            // filename differs by the camera zone and does not enter this branch.
            if (Math.abs(delta) <= MVHD_FINALIZE_TOLERANCE_SEC) {
                return { startUtc: localUnixFromNaiveClock(createdNaiveSec), source: "mp4" };
            }
        }
    }
    // b) Uncorroborated mvhd as-is (no correction). Risky - it may be off by
    //    hours with local-as-UTC firmware semantics, but the container stamp
    //    still beats the filename guesses below when no TZ estimate exists.
    if (createdUtc !== null) {
        return { startUtc: createdUtc.getTime() / 1000, source: "mp4" };
    }
    // b.5) Filename + the run-measured PRECISE offset (full precision, NOT the
    //    15-min-snapped filenameTzSec in (c)). A no-GPS sibling channel must land
    //    on the SAME t=0 as its GPS-bearing sibling: on 70mai-mc GPS lives only on
    //    the front, which anchors on filenameNaive - preciseFilenameOffsetSec, so
    //    rear/interior MUST subtract the identical offset or they diverge by the
    //    camera's sub-15-min RTC drift and tear out of the front's frame past the
    //    30s frame snap. Siblings share name times, so
    //    resolvePreciseClockOffsetForFile hands both the same run's offset.
    if (preciseFilenameOffsetSec !== null) {
        if (filenameLocalDate !== null) {
            return { startUtc: filenameLocalDate.getTime() / 1000 - preciseFilenameOffsetSec, source: "name" };
        }
    }
    // c) Filename + per-vendor TZ (filename-source estimate). Vendor TZ was
    //    estimated from other files in the ingest that DO have GPS.
    if (fingerprintTz?.filenameTzSec != null) {
        if (filenameLocalDate !== null) {
            const pseudo = filenameLocalDate.getTime() / 1000;
            return { startUtc: pseudo - fingerprintTz.filenameTzSec, source: "name" };
        }
    }
    // d) Filename without any TZ info - interpret as the user's local clock.
    //    Hits when the whole ingest has neither mvhd nor GPS (e.g. MPEG-TS
    //    sticks without telemetry), so vendor TZ cannot be inferred at all.
    //    Reasonable assumption: the user is viewing footage recorded in their
    //    own time zone. If not, the timestamp will be off, but it is still
    //    vastly more useful than mtime (which carries the file copy date,
    //    not the recording date).
    //
    //    parseFilenameLocalTime returns a Date constructed via Date.UTC(...),
    //    so reinterpret its UTC fields as a local wall clock.
    if (filenameLocalDate !== null) {
        return { startUtc: localUnixFromNaiveClock(filenameLocalDate.getTime() / 1000), source: "name" };
    }
    // e) Last resort - mtime minus duration. On 70mai x800 mtime can be off by hours;
    //    the UI marks this source as unreliable.
    const mtimeUtc = file.file.lastModified / 1000;
    return { startUtc: mtimeUtc - durationSec, source: "mtime" };
}

/**
 * Re-anchors GPS records whose clock was not synced (`timeUnsynced`) onto the
 * owning video's window. The position is real; only the time is a placeholder
 * written before the chip decoded satellite time. Cold start always precedes
 * the first real fix (the clock syncs once and stays), so unsynced rows map to
 * [startUtc, windowEnd): windowEnd is the first synced record's time on a mixed
 * file, or startUtc+durationSec on a file fully inside the cold-start window.
 * Points are spread evenly and stay strictly before the first synced row, so
 * the bucket remains sorted, the map track renders, and the player can bind a
 * record to playback time (frame.startUtc + offset). When every unsynced record
 * carries a trustworthy per-record relative offset (`relStartSeconds`), they are
 * placed at startUtc+offset instead of evenly - accurate across cold-start /
 * mid-file GPS gaps that even spacing would smear.
 *
 * Mutates `unixSeconds` in place; the `timeUnsynced` flag stays set (the time
 * is now an approximation tied to the video clock, still not a GPS time
 * source), so a later deriveStartUtc / TZ pass keeps ignoring it and a re-run
 * with the same startUtc reproduces the same times. No-op when nothing is
 * unsynced.
 */
export function reanchorUnsyncedTimes(records: GpsRecord[], startUtc: number, durationSec: number): void {
    const idx: number[] = [];
    for (let i = 0; i < records.length; i++) {
        if (records[i]!.timeUnsynced) idx.push(i);
    }
    if (idx.length === 0) return;

    const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
    const firstSynced = firstSyncedRecord(records);
    let windowEnd = firstSynced ? firstSynced.unixSeconds : startUtc + dur;
    // Guard against an empty/inverted window (zero-duration index, or a synced
    // record earlier than the derived start due to clock skew): fall back to the
    // duration window, then a 1s sentinel, so the spacing stays monotonic.
    if (windowEnd <= startUtc) windowEnd = startUtc + (dur > 0 ? dur : 1);

    const span = windowEnd - startUtc;
    const n = idx.length;

    // Offset path: if EVERY unsynced record carries a trustworthy per-record
    // relative offset (relStartSeconds, e.g. the 70mai Pro `GPS ` box `seconds`
    // field), place each at startUtc+offset instead of spreading evenly. This is
    // accurate on clips with a cold-start or mid-file GPS gap, where even spacing
    // would smear the surviving fixes across the whole window. Offsets are
    // monotonic non-decreasing, so clamping into [startUtc, windowEnd) keeps the
    // bucket sorted and strictly before any synced row. Deterministic in startUtc
    // -> still idempotent. Falls through to even spacing if any offset is missing
    // (mixed sources, or formats without per-record time).
    const allHaveOffsets = idx.every((i) => Number.isFinite(records[i]!.relStartSeconds));
    if (allHaveOffsets) {
        // Keep the last point a hair below windowEnd so a synced row (if any)
        // stays strictly last; tiny relative to the window, never below 0.
        const epsilon = Math.min(0.5, span / 1000);
        for (const i of idx) {
            const t = startUtc + (records[i]!.relStartSeconds as number);
            records[i]!.unixSeconds = t < startUtc ? startUtc : t >= windowEnd ? windowEnd - epsilon : t;
        }
        return;
    }

    for (let k = 0; k < n; k++) {
        // Center each point in its 1/n slice - strictly inside (startUtc, windowEnd).
        records[idx[k]!]!.unixSeconds = startUtc + ((k + 0.5) * span) / n;
    }
}

/**
 * Subtracts the fleet-measured local-as-UTC clock offset from the record axis
 * so records carry true UTC. Evidence is per-file
 * (VideoCandidate.localClockOffsetHintSec - the cold-start clock jump, see
 * primitives/freegps.ts) but the correction is per FINGERPRINT: most clips
 * never catch a GPS fix mid-file, so they inherit the lower median of their
 * siblings' measurements.
 *
 * Idempotent by construction: each record carries how much has already been
 * subtracted (GpsRecord.localClockOffsetAppliedSec), so re-running the sweep
 * - or visiting a record twice through candidates and gpsLog buckets that
 * share the objects - applies only the delta. Late evidence (a cold-start
 * clip becoming ready after its siblings shifts everything by the difference on
 * the next sweep.
 *
 * A fingerprint with no evidence in this call is left untouched. Progressive
 * per-trip refinement may not include the sibling that measured the offset;
 * resetting to zero would temporarily corrupt an already-correct record axis.
 * A shift can therefore only be replaced by new evidence, never withdrawn.
 *
 * Scoped to candidates whose GPS came from the extractor family that
 * produces the hints ("freegps"): the offset describes THAT firmware's clock,
 * and records from an unrelated source on the same fingerprint (a GPX
 * sidecar with honest UTC) must not inherit it. The scope is per CANDIDATE,
 * so a sidecar merged onto a file that already parsed as freegps rides along
 * - records carry no source tag to filter on.
 *
 * One offset per fingerprint for the whole dump: a set spanning the camera's
 * own DST re-sync gets the majority cluster's value on both sides, same
 * exposure as the TZ estimate (see displayTzSec).
 */
function applyLocalClockCorrections(candidates: readonly VideoCandidate[]): void {
    const hintsByFingerprint = new Map<string, number[]>();
    for (const c of candidates) {
        if (c.localClockOffsetHintSec === null) continue;
        let bucket = hintsByFingerprint.get(c.fingerprint);
        if (!bucket) {
            bucket = [];
            hintsByFingerprint.set(c.fingerprint, bucket);
        }
        bucket.push(c.localClockOffsetHintSec);
    }
    if (hintsByFingerprint.size === 0) return;

    const offsetByFingerprint = new Map<string, number>();
    for (const [fingerprint, hints] of hintsByFingerprint) {
        hints.sort((a, b) => a - b);
        // Lower median (an observed element) - same reasoning as
        // snappedMedianTz: an even-count average could land between two
        // real measurements on a value belonging to neither.
        offsetByFingerprint.set(fingerprint, hints[(hints.length - 1) >> 1]!);
    }

    let movedRecords = 0;
    for (const c of candidates) {
        if (!c.appliedExtractors.includes("freegps")) continue;
        const desired = offsetByFingerprint.get(c.fingerprint);
        if (desired === undefined) continue;
        for (const record of c.records) {
            if (record.externalTrack) continue;
            const applied = record.localClockOffsetAppliedSec ?? 0;
            if (applied === desired) continue;
            record.unixSeconds += applied - desired;
            if (desired === 0) delete record.localClockOffsetAppliedSec;
            else record.localClockOffsetAppliedSec = desired;
            movedRecords++;
        }
    }
    // The whole record axis just moved by hours, and a wrong offset surfaces
    // as wrong dates everywhere at once - this line is what tells a bug report
    // apart from a camera that really sits in that zone. Only on an actual
    // shift: the sweep re-runs per indexing batch and is a no-op after the
    // first one.
    if (movedRecords > 0) {
        log.info("local-as-UTC clock correction", {
            offsetsSec: [...offsetByFingerprint.values()],
            records: movedRecords,
        });
    }
}

/**
 * Re-derives startUtc/startSource for every candidate from its CURRENT
 * createdUtc + records: estimates per-fingerprint TZ and the precise clock
 * offset from this same set first, then runs deriveStartUtc per file and
 * re-anchors its cold-start records onto the now-known video window. Mutates the
 * candidates in place; does NOT regroup - the caller decides whether to rebuild
 * trips.
 *
 * Single source of truth for both per-trip refinement and the closing global
 * sweep. Calling it after metadata or GPS arrives replaces provisional clock
 * evidence before trip boundaries are reconciled.
 */
export function rederiveStartUtcForCandidates(
    candidates: readonly VideoCandidate[],
    parseFilenameLocalTime: (file: VendorFile) => Date | null,
): void {
    // Restore true UTC on the record axis FIRST: every estimate below
    // (TZ medians, precise clock offsets, GPS windows) reads record times,
    // and local-as-UTC records would bake the camera zone into all of them.
    applyLocalClockCorrections(candidates);

    const tzSamples: TzSample[] = [];
    // Dedup by File IDENTITY, not basename: two DISTINCT files can share a
    // basename (a Viofo RO/ protected copy vs its Movie/ sibling, or the same
    // folder layout on two SD cards) and keying by name would collapse them into
    // one sample, dropping a real (filename - firstGps) delta - and, below the
    // 2-file floor, suppressing the precise clock offset entirely. File-object
    // identity distinguishes physical files and survives regroups.
    const seen = new Set<File>();
    for (const c of candidates) {
        if (seen.has(c.file)) continue;
        // firstSyncedRecord, not records[0]: cold-start (timeUnsynced) rows carry
        // a placeholder clock and must not feed the TZ estimate.
        const firstSynced = firstSyncedRecord(c.records);
        if (!firstSynced) continue;
        seen.add(c.file);
        tzSamples.push({
            file: { file: c.file, relativePath: c.relativePath },
            fingerprint: c.fingerprint,
            firstGpsUnix: firstSynced.unixSeconds,
            mvhdNaiveUnix: c.createdUtc !== null ? c.createdUtc.getTime() / 1000 : null,
            durationSec: c.durationSec,
        });
    }
    const tzByFingerprint = estimateTzByFingerprint(tzSamples, parseFilenameLocalTime);
    const preciseOffsetRuns = estimatePreciseClockOffsetByFingerprint(tzSamples, parseFilenameLocalTime);

    // Wall spans first, over the WHOLE set: deriveStartUtc validates GPS
    // windows against them (a time-lapse clip's GPS covers the wall span, not
    // the video duration), and the cadence fallback needs every clip's
    // neighbors before any single clip can be judged.
    for (const c of candidates) {
        const filenameLocal = parseFilenameLocalTime({ file: c.file, relativePath: c.relativePath });
        c.wallDurationSec = deriveWallDurationSec({
            isTimelapse: c.isTimelapse,
            durationSec: c.durationSec,
            createdUtc: c.createdUtc,
            records: c.records,
            filenameNaiveSec: filenameLocal !== null ? filenameLocal.getTime() / 1000 : null,
        });
    }
    applyTimelapseCadenceWallSpans(candidates, parseFilenameLocalTime);

    // Per-fingerprint tally of clips whose mvhd could not be reconciled with
    // their own GPS window (see the tripwire log after the loop).
    const mvhdRejects = new Map<string, number[]>();

    for (const c of candidates) {
        const vendorFile = { file: c.file, relativePath: c.relativePath };
        const { startUtc, source, mvhdRejected } = deriveStartUtc({
            file: vendorFile,
            fingerprint: c.fingerprint,
            createdUtc: c.createdUtc,
            durationSec: c.durationSec,
            records: c.records,
            fingerprintTz: tzByFingerprint.get(c.fingerprint) ?? null,
            parseFilenameLocalTime,
            preciseFilenameOffsetSec: resolvePreciseClockOffsetForFile(
                preciseOffsetRuns,
                c.fingerprint,
                vendorFile,
                parseFilenameLocalTime,
            ),
            embeddedStartUtcHint: c.embeddedStartUtcHint,
            isTimelapse: c.isTimelapse,
            wallDurationSec: c.wallDurationSec,
        });
        c.startUtc = startUtc;
        c.startSource = source;
        // Display-layer snapshot, NOT an anchor input: the UI renders
        // startUtc + this (see displayTzSec). filenameTzSec only - the mvhd
        // estimate reflects the container clock, not the OSD clock.
        c.cameraTzSec = tzByFingerprint.get(c.fingerprint)?.filenameTzSec ?? null;
        if (mvhdRejected && c.createdUtc !== null) {
            const firstSynced = firstSyncedRecord(c.records);
            if (firstSynced) {
                let deltas = mvhdRejects.get(c.fingerprint);
                if (!deltas) {
                    deltas = [];
                    mvhdRejects.set(c.fingerprint, deltas);
                }
                deltas.push(firstSynced.unixSeconds - c.createdUtc.getTime() / 1000);
            }
        }
        // Now that the file's start is known, pull cold-start records (valid
        // position, unsynced clock) onto the video window - the WALL window
        // for a time-lapse clip (its records cover real seconds, not video
        // seconds). No-op when none.
        reanchorUnsyncedTimes(c.records, startUtc, c.wallDurationSec ?? c.durationSec);
    }

    // Tripwire for the class of bug where a camera stamps one of its two clocks
    // in local time: no mvhd reading (start, finalize, fleet-TZ) lands the
    // clip's own GPS window, so the clips carrying GPS and their GPS-less
    // siblings end up anchored by different rules and a continuous drive splits
    // into pieces. Nothing here changes an anchor - it names the camera and the
    // size of the disagreement so a diagnostics report says which clock lies.
    for (const [fingerprint, deltas] of mvhdRejects) {
        log.warn("mvhd cannot be reconciled with its own gps window", {
            fingerprint,
            files: deltas.length,
            gpsMinusMvhdSec: Math.round(snappedMedianTz(deltas) ?? 0),
        });
    }
}

// Domain types for parsers. Capability-first architecture - no vendor entity
// (VendorPlugin et al.); the GPS byte format is described by Primitive in
// primitives/types.ts, filename heuristics by filename/types.ts, sidecars by
// SidecarHandler / AccelSidecarHandler below.

// One decoded GPS record. Extractors convert native units (DDDmm.mmmm for
// Novatek, knots for NMEA) to decimal degrees and m/s. Firmware quirks
// (70mai 8h-bias, Y-up accel) are applied INSIDE the extractor; callers get
// honest UTC and gravity-removed accel.
export interface GpsRecord {
    unixSeconds: number;
    // GPS fix was valid at record time (true = valid lat/lon).
    active: boolean;
    lat: number; // decimal degrees
    lon: number; // decimal degrees
    bearingDeg: number; // degrees [0..360)
    speedMs: number; // m/s
    // Acceleration in g, gravity-removed (dynamic component). At rest = 0,0,0.
    // Formats without an accelerometer (GPX, GPMF, NMEA sidecar, BlackVue
    // legacy) leave zeros; magnitude 0 -> brake-detector ignores.
    accelXg: number;
    accelYg: number;
    accelZg: number;
    // Name of the MP4 this record belongs to. Set by the extractor from a
    // log field (70mai $V02 field[9]), matched MP4 for GPX sidecars, or
    // File.name when GPS is embedded in the video.
    mp4Filename: string;
    // The position fix is valid but the GPS *clock* was not yet synced when
    // this record was written (cold start after a power-up: the chip delivers
    // coordinates before it decodes satellite time, so the firmware stamps a
    // near-epoch placeholder). `unixSeconds` is therefore NOT a trustworthy
    // wall-clock: the time layer ignores such records when deriving a file's
    // start / camera TZ, and re-anchors their `unixSeconds` onto the owning
    // video's window so the track still renders. Absent/false = real GPS time.
    timeUnsynced?: boolean;
    // For a `timeUnsynced` record that nonetheless carries a trustworthy
    // per-record *relative* offset from the clip's recording start (seconds),
    // this holds that offset. Some formats have no wall-clock but DO timestamp
    // each fix relative to start (the older 70mai Pro `GPS ` box `seconds`
    // field). reanchorUnsyncedTimes places such records at startUtc+offset
    // instead of spreading them evenly by index - accurate on clips with a
    // cold-start or mid-file GPS gap. Absent = no offset (spread evenly).
    relStartSeconds?: number;
}

/**
 * Knots -> m/s. Several primitives store speed in knots (NMEA RMC, freeGPS,
 * LigoGPS); they convert to GpsRecord.speedMs through this single constant so
 * the factor cannot drift between formats.
 */
export const KNOTS_TO_MS = 0.514444;

/**
 * Miles-per-hour -> m/s. US-market formats store speed in mph (Garmin PNDM,
 * Garmin uuid records, Vantrue FMAS); same single-constant rule as above.
 */
export const MPH_TO_MS = 0.44704;

/** Km/h -> m/s; same single-constant rule as above. */
export const KMH_TO_MS = 1 / 3.6;

// A skipped line with its reason, for diagnostics.
export interface SkippedLine {
    line: number;
    raw: string;
    reason: string;
}

// Aggregated GPS result for one ingest session.
export interface ParsedLog {
    /** Primitive ids that contributed records to this ParsedLog. */
    appliedExtractors: string[];
    records: GpsRecord[];
    // Records grouped by mp4Filename and sorted by unixSeconds.
    // Primary index used by the player to look up records for the current file.
    byFilename: Map<string, GpsRecord[]>;
    skipped: SkippedLine[];
}

// Interpolated position between adjacent GPS points. Acceleration is excluded
// because interpolating it at 1 Hz sampling is meaningless.
export interface InterpolatedPosition {
    lat: number;
    lon: number;
    bearingDeg: number;
    speedMs: number;
}

// File with path relative to the selected folder root. Path matters: some
// formats encode channel / mode in the directory tree (Movie/Front/,
// TeslaCam/SentryClips/) instead of in the filename.
export interface VendorFile {
    file: File;
    relativePath: string;
}

// Camera channel for multi-camera recorders.
//
// "side" - 4th camera on 4-channel models (CARCAM 4CH 360-WiFi, etc.,
// typically truck/fleet). Specific mount (side-mirror / rear-side / cargo)
// varies by model; shown as generic "Side" in the UI for now.
export type Channel = "front" | "rear" | "interior" | "side";

// Recording mode - meaningful for some formats (BlackVue encodes it in the
// filename as N/E/P/M). Stored in VideoCandidate; not displayed in UI yet.
export type RecordingMode = "normal" | "event" | "parking" | "manual";

// Thrown by extractor.parse() and SidecarHandler.parse() when the marker
// matched but the content does not. Dispatcher catches it and tries the
// next extractor; one broken file does not abort the whole ingest.
export class WrongFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WrongFormatError";
    }
}

// Result of parsing one GPS source (a log file or an MP4 with embedded data).
export interface ParsedRecords {
    records: GpsRecord[];
    skipped: SkippedLine[];
    // Optional: absolute UTC of video frame 0 as known from the GPS source
    // itself (e.g. RVMI tReV OLE-date baseline, which RegistratorViewer writes
    // at media-time 0 of the metadata track). Authoritative for files where
    // mvhd.creation_time is wrong (fragments cut from a longer original keep
    // the parent's mvhd, so deriveStartUtc otherwise falls back to first GPS
    // fix and chart leads video by GPS-fix delay). Only primitives that can
    // tie a wall-clock to media-time 0 should set this; absent for GPS sources
    // that only know per-sample timestamps.
    // Second contract: `records: []` PLUS a defined hint is a positive claim
    // on the file - the registry stops the extractor walk and keeps the hint
    // and skip diagnostics (a quality-gated parse that condemned every fix,
    // e.g. the sstar-ssmd phantom-track gate). Empty records WITHOUT a hint
    // stays "matched the shape, carries no GPS" and lets siblings walk.
    videoStartUtcHint?: number;
    // Optional: accelerometer samples the primitive found in the container
    // itself (an embedded `3gf ` child, a `gsen` atom, a binary preamble next
    // to the GPS record). Kept as AccelSample - the same type an accel-only
    // sidecar produces - rather than folded into GpsRecord.accel*g, because
    // these streams run at their own rate (5-20 Hz against 1 Hz GPS) and must
    // go through mergeAccelSamples to land on the nearest record. The
    // dispatcher collects them per file; source (sidecar vs container) makes
    // no difference past that point.
    accelSamples?: AccelSample[];
}

// Vendor-neutral sidecar handlers for basename-binding formats (GPX,
// NMEA `.gps`, Escort `.map`). Separate contract from Primitive: classification
// runs via matches(file, knownVideos) which needs the list of known MP4s.
export interface SidecarHandler {
    id: string;
    // Returns the MP4 name if this file is a sidecar of one of knownVideos; null otherwise.
    matches(file: VendorFile, knownVideos: Set<string>): string | null;
    // Parses the sidecar and binds records to the given mp4Filename.
    // signal (optional): cancellation; same contract as Primitive.parse -
    // honored on iteration boundaries when present, ignored otherwise.
    parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]>;
}

// One accelerometer sample with relative time from video start. Used for
// accel-only sidecars (BlackVue `.3gf`); absolute time is resolved after
// ingest via VideoCandidate.startUtc.
export interface AccelSample {
    msSinceStart: number;
    accelXg: number;
    accelYg: number;
    accelZg: number;
}

// Handler for accel-only sidecars (no GPS). After ingest, app.ts merges
// samples into GpsRecords via msSinceStart + startUtc -> nearest GPS record.
export interface AccelSidecarHandler {
    id: string;
    matches(file: VendorFile, knownVideos: Set<string>): string | null;
    // signal (optional): cancellation; same contract as SidecarHandler.parse.
    parseAccel(file: VendorFile, signal?: AbortSignal): Promise<AccelSample[]>;
}

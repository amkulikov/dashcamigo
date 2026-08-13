// Shared regex constants for filename techniques.
//
// One source of truth per filename family - if a vendor's firmware changes
// the naming, this is the single place to update. Per-field technique files
// (time.ts / channel.ts / mode.ts / sequence.ts) import the constants they
// need; the regex never gets out of sync across fields.

// 70mai: NO (normal) / EV (event) / LA / PA (A510 parking timelapse /
// parking event) prefix + 8-digit date + - + 6-digit time + optional
// -counter + optional trailing 14-digit wall-clock timestamp (M500 and app
// exports) + optional F/B/R/I channel letter. The channel letter sits either
// BEFORE the trailing timestamp (app-export shape `...-000195R-<14d>.mp4`,
// group m[8]) or at the very end (group m[9]); a file carries at most one of
// the two, so consumers read `m[8] ?? m[9]`. R is the A810 lite rear (B is
// rear on the older multi-channel S500/A810/T800 and on the A510). The
// prefix is a NON-capturing group so the m[1..9] group indices stay stable
// for every consumer (time / channel / sequence / camera-key all key off
// this one regex): m[1..6] datetime, m[7] counter, m[8]/m[9] channel.
export const RX_70MAI =
    /^(?:NO|EV|LA|PA)(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?([FBIR])?(?:-\d{14})?([FBIR])?\.mp4$/i;
export const RX_70MAI_PATH_CHANNEL = /(?:^|\/)(Front|Back|Interior)\//i;
// Recording-mode folders on a 70mai card. Single source for both the path-mode
// regex and camera-key's parent-dir strip list - a mode folder added here
// reaches both, so a new name cannot silently re-fragment trips.
export const MAI70_MODE_FOLDERS = ["normal", "event", "lapse", "manual", "parking"] as const;
export const RX_70MAI_PATH_MODE = new RegExp(`(?:^|/)(${MAI70_MODE_FOLDERS.join("|")})/`, "i");
// 70mai filename prefix carries the recording mode when the folder layout is
// absent (flat drop): NO = normal loop, EV = g-sensor/impact event, LA =
// parking timelapse, PA = parking g-sensor/motion event (A510 parking mode).
// Read only after RX_70MAI has matched, so the two-letter prefix cannot claim
// a foreign name (e.g. "NOTES.mp4").
export const RX_70MAI_PREFIX_MODE = /^(NO|EV|LA|PA)/i;
// Invariant core of a 70mai clip name: datetime + optional counter + optional
// channel letter, WITHOUT the 2-letter mode prefix and WITHOUT anything after
// ".MP4". The GPSData CSV log references clips by name, but the firmware's
// name and the name on disk can disagree in exactly those two spots: a locked
// clip is renamed across mode prefixes (recorded as normal, locked to
// EV/VL...), and X800 firmware appends garbage after ".MP4" in the log row
// ("VL...F.MP4G4"). The core survives both, and it is unique per card
// (timestamp + sequence + channel), so it is the join key for rebinding log
// records to loaded videos (rebindOrphanLogRecords in parser.ts).
const RX_70MAI_NAME_CORE = /^[A-Z]{2}(\d{8}-\d{6}(?:-\d+)?[FBIR]?)\.MP4/i;

/** Returns the invariant 70mai name core (uppercased), or null for a name
 *  that does not have the 70mai shape. */
export function mai70NameCore(name: string): string | null {
    const m = name.match(RX_70MAI_NAME_CORE);
    return m ? m[1]!.toUpperCase() : null;
}

// Channel-letter strip for camera fingerprinting: removes the F/B/I/R letter
// from BOTH positions RX_70MAI accepts (terminal, or before the app-export
// 14-digit stamp). Must stay in lockstep with RX_70MAI's tail grammar - it is
// self-gating on names RX_70MAI matched (the char in that slot is otherwise a
// digit), so callers apply it unconditionally after a match.
export const RX_70MAI_CHANNEL_STRIP = /[FBIR]((?:-\d{14})?\.mp4)$/i;

// BlackVue DR-series: YYYYMMDD_HHMMSS_<Mode><Channel>.mp4.
// Mode in N/E/P/M, Channel in F/R/I.
// Beferich (J18, ...): `2026-08-03_11_34_53_f.mp4`. Same datetime core as
// RX_FORD but `.mp4` and no FordFootage/ gate - the trailing channel letter
// keeps the two disjoint via the extension. Front-only corpus: `f` is
// confirmed, other letters map by mnemonic (see beferich-channel).
export const RX_BEFERICH = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})_(\d{2})_([a-z])\.mp4$/i;

export const RX_BLACKVUE = /^(\d{8})_(\d{6})_([NEPM])([FRI])\.mp4$/i;

/**
 * Channel-independent recording key for a BlackVue clip: `date_time_mode`
 * (lowercased), dropping the F/R/I channel letter. The front, rear and interior
 * clips of one recording share it, so it pairs a shared `_N.gps`/`_N.3gf`
 * sidecar with every channel (matchBlackvueSidecarBasename) and clones that GPS
 * across the channels so they anchor identically (cloneRecordsAcrossChannels).
 * null for names that are not BlackVue-shaped.
 */
export function blackvueChannelGroupKey(name: string): string | null {
    const m = name.match(RX_BLACKVUE);
    return m ? `${m[1]}_${m[2]}_${m[3]}`.toLowerCase() : null;
}

// CarCam 4CH 360-WiFi: REC + date - time - sequence - A/B/C/D channel.
export const RX_CARCAM = /^REC(\d{8})-(\d{6})-(\d{1,5})-([ABCD])\.mp4$/i;
// Unbranded single-channel SigmaStar cam: REC + date - time - sequence and
// NOTHING after it - the missing channel letter is exactly what keeps it
// disjoint from RX_CARCAM (the -A..D suffix is mandatory there). No GPS data
// in the corpus sample; name classification only.
export const RX_REC_SINGLE = /^REC(\d{8})-(\d{6})-(\d{1,5})\.mp4$/i;
export const RX_CARCAM_PATH_FRONT = /(?:^|\/)normal\/a\//i;
export const RX_CARCAM_PATH_REAR = /(?:^|\/)normal\/b\//i;
export const RX_CARCAM_PATH_INTERIOR = /(?:^|\/)normal\/c\//i;
export const RX_CARCAM_PATH_SIDE = /(?:^|\/)normal\/d\//i;
export const RX_CARCAM_PATH_EVENT = /(?:^|\/)event\//i;
export const RX_CARCAM_PATH_PARKING = /(?:^|\/)parking\//i;

// Unbranded SigmaStar 3-4CH cam (card carries `.sstar.format` markers): a
// leading CH<n> channel index + - + 8-digit date - 6-digit time + .ts, one clip
// per channel dropped into a per-channel `CH<n>` folder under Normal/. CH<n> is
// an index, not a mnemonic (like CarCam A/B/C/D), so the mount mapping is a best
// guess. The mandatory `CH` prefix + `.ts` keeps it disjoint from every other
// .ts family (novatek-ts / fitcamx / juscar / ford all start with a digit).
// No embedded GPS in the corpus (the paired same-basename .TXT sidecars are
// 0-byte); name classification only.
export const RX_SSTAR_CHN = /^CH([1-4])-\d{8}-\d{6}\.ts$/i;

// DDPai - three name variants for normal / timelapse-parking / event.
// The "normal" shape `<14-digit>_<counter>` is NOT DDPai-exclusive: Novatek-
// family cameras (VIOFO A119 Mini Pro / Mini 2, Roadgid Tube, Fujida Karma)
// name their clips the same way with 6-7 digit counters and keep freeGPS
// INSIDE the MP4. The
// ddpai-normal source hint sets probeIfNoRecords for exactly that reason -
// widening the counter here must never turn into a hard embedded-probe skip.
export const RX_DDPAI_NORMAL = /^(\d{14})_(\d{2,7})(?:_([A]))?\.mp4$/i;
export const RX_DDPAI_TIMELAPSE = /^([SQ])_(\d{14})_(\d{3,5})_(\d{2,4})\.mp4$/i;
export const RX_DDPAI_EVENT = /^G_(\d{14})_(\d{2,5})_([LX])\.mp4$/i;
export const RX_DDPAI_TIMESTAMP_TOKEN = /(\d{14})/;

// E-Ace: digits_digits[FR].mp4 (channel suffix optional on single-channel models).
export const RX_E_ACE = /^(\d{8})_(\d{6})([FR])?\.mp4$/i;

// Escort M2: digits_digits_CAM.mp4. Time has no seconds field.
export const RX_ESCORT = /^(\d{8})_(\d{4})_CAM\.mp4$/i;
export const RX_ESCORT_PATH_EVENT = /(?:^|\/)event\//i;
export const RX_ESCORT_PATH_MANUAL = /(?:^|\/)favorites\//i;
export const RX_ESCORT_PATH_NORMAL = /(?:^|\/)normal\//i;

// FitCamX: 14-digit timestamp + _ + 6-digit token + letter + .ts.
// Channel/mode come from parent folder (Movie / Movie_E / EMR / EMR_E).
export const RX_FITCAMX = /^(\d{14})_(\d{6})([A-Z])\.ts$/i;
export const RX_FITCAMX_PATH_REAR = /(?:^|\/)(movie_e|emr_e)\//i;
export const RX_FITCAMX_PATH_FRONT = /(?:^|\/)(movie|emr)\//i;
export const RX_FITCAMX_PATH_EVENT = /(?:^|\/)(emr|emr_e)\//i;
export const RX_FITCAMX_PATH_NORMAL = /(?:^|\/)(movie|movie_e)\//i;

// Ford built-in dashcam (records to a USB stick, footage lands in a
// FordFootage/ folder): YYYY-MM-DD_HH_MM_SS_<channel>.ts. Per a real sample:
// H.264 2560x1440 + AAC + a single JPEG poster frame on a private stream
// (stream_type 0x89), and NO embedded GPS/telemetry. Channel letter: `f` is
// front (confirmed). Any other letter is a different channel - the corpus is
// front-only so far, so the rear/other letters are an assumption (mnemonic
// r/b = rear, i = interior), to be revalidated on the first real sample.
// Brand is inferred from the folder name + naming scheme, not from container
// metadata (the JPEG's EXIF Make/Model are blank).
export const RX_FORD = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})_(\d{2})_([a-z])\.ts$/i;
// The FordFootage/ folder is what actually identifies the format - the
// `YYYY-MM-DD_HH_MM_SS_x.ts` name shape is generic. The source-hint gates on
// this path so a same-named .ts from another camera is not silently skipped.
export const RX_FORD_PATH = /(?:^|\/)FordFootage\//i;

// HP (f969x; SigmaStar CarDV firmware per the TS service descriptor): HPIM +
// 8-digit date - 6-digit time + channel letter + .TS, card layout
// `<Mode>/<channel letter>/` (Normal/F/ in the corpus). `f` = front is the
// only letter observed; other letters map by mnemonic (see hpim-channel).
// The container is HEVC + a low-res H264 preview + AAC + a JPEG poster on a
// private PES. GPS burns into the picture (OSD coordinates + speed) but is
// written nowhere machine-readable - the PMT-declared private data slots stay
// empty even with an on-screen confirmed fix, so the format carries a "none"
// gps-source hint (rationale at the hint entry).
export const RX_HPIM = /^HPIM(\d{8})-(\d{6})([A-Z])\.ts$/i;

// iBox: FILE + 2-digit-year YY MM DD - HHMMSS + F/R/I channel + extension.
export const RX_IBOX = /^FILE(\d{2})(\d{2})(\d{2})-(\d{6})([FRI])\.(mp4|mov)$/i;
export const RX_IBOX_PATH_EVENT = /(?:^|\/)event\//i;
export const RX_IBOX_PATH_PARKING = /(?:^|\/)parking\//i;

// Mio / Navman MiVue (budget line: MiVue 150 Safety, ...): FILE + 2-digit-year
// YY MM DD - HHMMSS + extension. NO channel letter (single-lens) and NO sequence
// counter - that is exactly what keeps it disjoint from iBox (FILE...<FRI>) and
// Navitel (FILE...-<6-digit seq>), so the three FILE-prefixed regexes never
// claim each other's files. YYMMDD (not DDMMYY) is confirmed against the GPS
// clock on a real sample: name 260625 == GPRMC date 2026-06-25. GPS lives in a
// same-basename `.NMEA` sidecar; the MP4 itself carries no embedded GPS.
export const RX_MIVUE = /^FILE(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(?:mp4|mov)$/i;
// MiVue SD layout splits recording mode into top-level folders (Normal/, Event/,
// Parking/; Photo/ holds JPEG snapshots, not videos). Generic names, so the mode
// technique gates on RX_MIVUE first before trusting the folder. Shared with
// hpim-mode - the HP card speaks the same Normal/Event/Parking folder language
// (Normal/ is corpus-confirmed, the other two are the standard CarDV set).
export const RX_MIVUE_PATH_MODE = /(?:^|\/)(Normal|Event|Parking)\//i;

// Juscar: 8-digit date _ 6-digit time + F/R + .ts.
export const RX_JUSCAR = /^(\d{8})_(\d{6})([FR])\.ts$/i;
export const RX_JUSCAR_PATH_REAR = /(?:^|\/)rear\/[^/]*$/i;
export const RX_JUSCAR_PATH_FRONT = /(?:^|\/)front\/[^/]*$/i;
export const RX_JUSCAR_PATH_EVENT = /(?:^|\/)event\//i;
export const RX_JUSCAR_PATH_VIDEO = /(?:^|\/)video\//i;

// Navitel: FILE + 2-digit-year YY MM DD - HH MM SS - 6-digit sequence + optional letter.
export const RX_NAVITEL = /^FILE(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{6})([A-Z])?\.(?:mov|mp4)$/i;

// Unknown-vendor 3-channel .mov camera: 14-digit datetime + _ + 7-digit
// sequence + F/R/I channel letter. The FitCamX stamp+counter language, but
// `.mov` with a 7-digit counter (FitCamX is `.ts` with a 6-digit token) -
// extension and counter width keep the two disjoint, and the mandatory
// trailing letter keeps it off RX_DDPAI_NORMAL twins. F/R/I are standard
// mnemonics; the corpus is filename-only (diagnostic report, all three
// letters observed as one capture), so the mapping is content-unvalidated.
// No gps-source hint on purpose: where GPS lives is unknown, the default
// embedded probe stays on.
export const RX_MOV_SEQ_FRI = /^(\d{14})_(\d{7})([FRI])\.mov$/i;

// Nextbase (322GW family): yyMMdd_HHmmss_NNN_<channel><quality>.MP4.
// Channel B/F/R; quality H/L = parallel high/low-bitrate streams of the same
// lens recorded simultaneously. Upstream accepts the identical language as a
// 3-group regex ^(\d{6}_\d{6})_(\d{3})_([BFR][HL])\.MP4$ (nb-dashcam-tools
// src/clipmergewidget.cpp:194-196); ours splits the captures per field.
// Implemented from foreign source (nb-dashcam-tools); the FH (front,
// high-bitrate) shape is validated against a real 322GW-family clip - the
// other channel/quality letters remain foreign-source-only (listed
// untested-maybe for the 422/522/622GW in nb-dashcam-tools' compat table;
// unconfirmed for 512GW filenames).
export const RX_NEXTBASE = /^(\d{6})_(\d{6})_(\d{3})_([BFR])([HL])\.mp4$/i;

// Neoline (Spectrum family, SigmaStar chipset): INF + 8-digit date - 6-digit
// time - UNPADDED sequence - F/R channel. The corpus is front-only, so
// R = rear is an assumption from the mnemonic, to be revalidated on the
// first real rear sample. "INF" is likely the infinity-loop tag (unverified),
// not a mode marker - the name carries no recording mode. GPS is embedded
// (SigmaStar ssmd track; extraction is a separate primitive concern).
export const RX_NEOLINE = /^INF(\d{8})-(\d{6})-(\d+)-([FR])\.mp4$/i;

// Wolfbox (G900/i07 family, 1-3 channels): YYYY_MM_DD_HHMMSS_EE_C.MP4 where
// EE is a 2-digit event code (00 = normal, 02 = g-sensor event) and
// C = F/I/R channel letter. SD layout: <channel>_<mode> folders
// (front_norm, front_emer, rear_norm, extra_emer, ...; extra = interior).
export const RX_WOLFBOX = /^(\d{4})_(\d{2})_(\d{2})_(\d{6})_(\d{2})_([FIR])\.mp4$/i;
export const RX_WOLFBOX_PATH_FRONT = /(?:^|\/)front_(?:norm|emer|photo)\//i;
export const RX_WOLFBOX_PATH_REAR = /(?:^|\/)rear_(?:norm|emer|photo)\//i;
export const RX_WOLFBOX_PATH_INTERIOR = /(?:^|\/)extra_(?:norm|emer|photo)\//i;
export const RX_WOLFBOX_PATH_EVENT = /(?:^|\/)(?:front|rear|extra)_emer\//i;
export const RX_WOLFBOX_PATH_NORMAL = /(?:^|\/)(?:front|rear|extra)_norm\//i;

// Novatek family - three filename variants on the same chipset.
// VIOFO multi-channel: YYYY_MMDD_HHMMSS[_NNN]<P|E?><F|R|T|I>.mp4. Mode letter:
// P = parking, E = impact event, absent = normal driving. Channel letter:
// F/R/I = front/rear/interior, T = telephoto (3-channel models pair F+R with
// either T or I). The sequence counter is OPTIONAL: T130 parking clips and
// some OEM firmwares write `..._PR.mp4` / `..._F.mp4` with no counter at all
// (real-sample-validated, freeGPS parses) - consumers must treat an undefined
// m[4] as "no sequence" (null), never NaN/0. The E and T letters are
// implemented from foreign source (viofosync web/services/scanner.py:48-66,
// web/services/naming.py:99-107), not validated against a real sample.
export const RX_NOVATEK_VIOFO = /^(\d{4})_(\d{4})_(\d{6})_(\d+)?([PE]?)([FRTI])\.mp4$/i;
// Viofo/Novatek locked-clip folder: firmware MOVES g-sensor-locked and
// manually-locked clips into DCIM/Movie/RO/ with UNCHANGED filenames, so the
// lock is not inferable from the name (viofosync web/services/scanner.py:57-63;
// a119_join.py:86-96 shows the same layout on single-channel A119). The "ro"
// segment is too short to claim files on its own - consumers must gate on a
// Novatek name regex first.
export const RX_NOVATEK_PATH_RO = /(?:^|\/)ro\//i;
// Single-channel Novatek OEM (2E Drive, SilverStone F1, ...).
export const RX_NOVATEK_SINGLE = /^(\d{4})_(\d{4})_(\d{6})_(\d+)\.(mp4|mov)$/i;
// Vantrue: YYYYMMDD_HHMMSS_NNNN_<N|E|P>_<A|B|C>.mp4.
export const RX_NOVATEK_VANTRUE = /^(\d{8})_(\d{6})_(\d+)_([NEP])_([ABC])\.mp4$/i;
// Novatek MPEG-TS OEMs: 14-digit timestamp _ 6-digit counter + .ts - the
// RX_DDPAI_NORMAL name scheme in a TS container (GPS rides a private PES
// stream; extraction is a separate primitive concern). Disjoint from
// RX_FITCAMX, whose `\d{14}_\d{6}<letter>.ts` requires a trailing letter.
// Deliberately NOT part of isNovatekFamilyFilename: that predicate also feeds
// MP4-only consumers (the `novatek` hint's freeGPS semantics); TS files join
// the shared probe escalation via needsGpsProbeEscalation below instead.
export const RX_NOVATEK_TS = /^(\d{14})_(\d{6})\.ts$/i;

/**
 * Whether a filename belongs to the Novatek family (VIOFO multi-channel,
 * single-channel OEM, Vantrue) - the chipsets that ship freeGPS blocks.
 * Shared by the `novatek` gps-source hint and the dispatcher's marker-probe
 * escalation (registry.ts tryParseOne) so the two gates can never disagree
 * on what counts as a Novatek-family name.
 */
export function isNovatekFamilyFilename(name: string): boolean {
    return RX_NOVATEK_VIOFO.test(name) || RX_NOVATEK_SINGLE.test(name) || RX_NOVATEK_VANTRUE.test(name);
}

/**
 * Whether a "none"-classified file deserves the 16 MB marker re-probe before
 * giving up on embedded GPS. Owns the format list for the dispatcher's probe
 * escalation (registry.ts classifyAndWalk) so a new name shape is added HERE,
 * next to its regex, not inline in the shared gate. Members: Novatek-family
 * MP4 names (first freeGPS block can sit past the 4 MB window on high-bitrate
 * clips) and the novatek-ts TS shape (first GPS PES observed at ~3-4 MB,
 * already brushing the default window).
 */
export function needsGpsProbeEscalation(name: string): boolean {
    return isNovatekFamilyFilename(name) || RX_NOVATEK_TS.test(name);
}

// Tesla RecentClips: YYYY-MM-DD_HH-MM-SS-<camera>.mp4.
export const RX_TESLA_RECENT = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z_]+)\.mp4$/i;
// Tesla SavedClips/SentryClips: short filename (camera only); time is in the parent folder.
export const RX_TESLA_EVENT_FILENAME = /^([a-z_]+)\.mp4$/i;
export const RX_TESLA_EVENT_FOLDER = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/;
export const RX_TESLA_PATH = /(?:^|\/)teslacam\//i;
export const RX_TESLA_PATH_RECENT = /(?:^|\/)teslacam\/recentclips\//i;
export const RX_TESLA_PATH_SAVED = /(?:^|\/)teslacam\/savedclips\//i;
export const RX_TESLA_PATH_SENTRY = /(?:^|\/)teslacam\/sentryclips\//i;

// Thinkware: <REC|EVT|PARK|MAN>_<anything>_<F|R>.mp4. No time in name.
export const RX_THINKWARE = /^(REC|EVT|PARK|MAN)_.+_([FR])\.mp4$/i;

// Vueroid (S1 4K Infinite): 8-digit date _ 6-digit time _ INF _ F/R channel _
// N/E/P mode. "INF" is the model tag (Infinite), a fixed literal - it is what
// keeps the shape disjoint from BlackVue/Vantrue/E-Ace underscore names.
// N = normal is the real-sample-validated shape; E = event and P = parking
// are assumed from the mnemonic, as is the R rear channel (front-only
// corpus). No sequence counter in the name.
export const RX_VUEROID = /^(\d{8})_(\d{6})_INF_([FR])_([NEP])\.mp4$/i;

// Generic-datetime fallback: matches any YYYYMMDDhhmmss embedded in a filename
// under any separator. Registered last in FILENAME_TIME.
export const RX_GENERIC_DATETIME = /(\d{4})[-_T]?(\d{2})[-_T]?(\d{2})[-_T ]?(\d{2})[-_:]?(\d{2})[-_:]?(\d{2})/;

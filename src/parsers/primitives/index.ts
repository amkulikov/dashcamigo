// Explicit registry of all primitives. One import = one registration, no
// side-effect imports.
//
// Order matters for the dispatcher marker() walk - cheaper first, more
// expensive last. For video-embedded the cheapest are Mp4Index markers (sync
// DataView checks); more expensive are async-probes of a track's first
// sample; last is the streaming freeGPS scenario (4 MB chunks up to EOF).

import type { Primitive } from "./types.js";

import { autoVoxRiffPrimitive } from "./autovox-riff.js";
import { freeGpsBoxPrimitive } from "./free-gps-box.js";
import { freegps70maiPrimitive } from "./freegps-70mai.js";
import { freegpsPrimitive } from "./freegps.js";
import { garminUuidPrimitive } from "./garmin-uuid.js";
import { gpmfPrimitive } from "./gpmf.js";
import { gpsLogAtomPrimitive, gpsLogNbmtPrimitive } from "./gpslog-atom.js";
import { gpsBox70maiPrimitive } from "./gps-box-70mai.js";
import { juscarTsPrimitive } from "./juscar-ts.js";
import { kenwoodPrimitive } from "./kenwood.js";
import { ligoJsonPrimitive } from "./ligo-json.js";
import { ligoGpsPrimitive } from "./ligogps.js";
import { ligoGpsTrailerPrimitive } from "./ligogps-trailer.js";
import { navitelTailPrimitive } from "./navitel-tail.js";
import { nextbaseGdatPrimitive } from "./nextbase-gdat.js";
import { nextbaseSubtitlePrimitive } from "./nextbase-subtitle.js";
import { nmeaSubtitlePrimitive } from "./nmea-subtitle.js";
import { novatekTsPrimitive } from "./novatek-ts.js";
import { pndmPrimitive } from "./pndm.js";
import { roveGpmdPrimitive } from "./rove-gpmd.js";
import { roveSsmdPrimitive } from "./rove-ssmd.js";
import { rvmiPrimitive } from "./rvmi.js";
import { sstarSsmdPrimitive } from "./sstar-ssmd.js";
import { tsPesGpsPrimitive } from "./ts-pes-gps.js";
import { vantrueFmasPrimitive } from "./vantrue-fmas.js";
import { vueroidTxetPrimitive } from "./vueroid-txet.js";
import { wolfboxGpmdPrimitive } from "./wolfbox-gpmd.js";

import { csv70maiPrimitive } from "./csv-70mai.js";

// GPS primitives that extract from a video container. The dispatcher walks
// marker() in order; the first one yielding records wins.
//
// Order (cheaper first):
//   1. rvmi             - sync findRvmiTrack over Mp4Index.tracks (sampleFormat=="RVMI").
//      Goes first because RegistratorViewer rewrites the meta-track on
//      re-export, and its data is more accurate than the original vendor
//      markers (if the file went through RV, its GPS is fresher than what
//      remains).
//   2. free-gps-box     - sync index.freeGpsBoxInsideFree.
//   3. ligogps          - sync index.hasLigoGpsMarker.
//   4. navitel-tail     - sync (gps0 + IDIT atom check; ~264 B content probe
//      on the IDIT-less path).
//   4b. gps-box-70mai   - sync (top-level `GPS ` box check); older 70mai Pro.
//   4c. garmin-uuid     - sync usertype scan of moov uuid children; the exact
//      16-byte UUID cannot collide with any other marker.
//   4d. ligo-json       - sync head check of the top-level udta payload
//      (LIGOGPSINFO-JSON / GKU). Long-literal gated, in-memory.
//   4e. kenwood         - sync udta head check (VIDEOUUU) plus one conditional
//      ~40 B trailer probe (CCCC + GPSDATA--) for files whose box walk does
//      not reach EOF. Before freegps so udta/trailer-carried files never pay
//      the heavy streaming probe.
//   4e2. ligogps-trailer - conditional 64 KB probe of the trailing region for
//      the LIGOGPSINFO literal (Beferich J18). After kenwood (its probe is
//      40 B); only junk-tailed files pay this read at all.
//   4f. gpslog-atom     - sync head check of the top-level `udat` text-log atom
//      for an NMEA sentence or a Denver record shape, like the udta carriers.
//      After rvmi on purpose: a Datakam Player re-export can carry both, and
//      the RVMI track is the fresher data. The `nbmt` half of the same decoder
//      is registered separately, far below - see 7b.
//   4g. nextbase-gdat   - sync head check of the top-level `gdat` payload
//      (Base64 of a JSON object). Disjoint from the Nextbase SUBTITLE formats
//      below: different carrier, and software-written rather than firmware.
//   5. gpmf             - sync findGpmdTrack over Mp4Index.tracks (sampleFormat=='gpmd').
//   5b. wolfbox-gpmd    - async (probe first sample of the gpmd/meta track).
//      After gpmf: a gpmd track is checked for real GPMF KLV first; Wolfbox
//      files fall through (gpmf yields zero records) and land here.
//   5c. vantrue-fmas    - async (probe first sample of the gpmd track for the
//      strict 'FMAS\0\0\0\0' prefix). Same fall-through chain: gpmf ->
//      wolfbox -> fmas, each rejects the others' bytes.
//   5c2. rove-gpmd     - async first-sample probe for the XOR-0xAA literal in
//      a gpmd sample (Rove Stealth 4K). Last of the gpmd chain: gpmf, wolfbox
//      and fmas own the other dialects and reject these bytes.
//   5d. rove-ssmd       - sync structural gate (meta handler + ssmd format +
//      constant 32-byte stsz) then async first-sample probe. No overlap with
//      ligogps: that marker needs the LIGOGPSINFO literal and skips <64 B samples.
//   5e. sstar-ssmd      - sync structural gate (meta handler + ssmd format +
//      constant 40-byte stsz) then async first-sample probe (flags word
//      0x057E/0x047E + no-fix sentinel plausibility). Disjoint from rove-ssmd
//      by sample size and from ligogps by content.
//   5f. vueroid-txet    - sync structural gate (tvxt handler + mp4s format +
//      constant 72-byte stsz). tvxt is used by no other known format; placed
//      with the sync gates because it is cheaper than the async probes below.
//   6. pndm             - async (probe first sample of sbtl/text/meta track).
//   6b. nextbase-subtitle - async first-sample probe (length prefix + zero run
//      + '$GPRMC' at a fixed per-format offset). MUST precede nmea-subtitle:
//      the Thinkware marker half-claims Nextbase samples (coords parse, accel
//      lost) - see the collision note in nextbase-subtitle.ts.
//   7. nmea-subtitle    - async (probe first sample, costlier than pndm:
//      NMEA-text parsing).
//   7b. gpslog-atom-nbmt - the Nextbase `nbmt` half of the text-log decoder.
//      Cheap (its head is already in memory) but registered HERE, behind the
//      whole subtitle chain: `nbmt` is a Nextbase atom whose payload upstream
//      does not document at all, and a file that carries both would otherwise
//      lose the sample-validated track path - with it the accel stream, which
//      no text log carries. Cost of the late position is zero: a file without a
//      subtitle track fails those markers on the sample table alone.
//   8. juscar-ts        - name regex + hasLigoGpsMarker; handles MPEG-TS.
//   8c. ts-pes-gps      - INNOVV / DOD LS600W records in a private PES. After
//      novatek-ts: all three probe TS bodies, and each rejects the others'
//      signatures, so order is cost, not correctness.
//   8b. novatek-ts      - Novatek GPS struct in a private PES (MPEG-TS).
//      Mutually exclusive with juscar-ts by content (LIGOGPSINFO literal vs
//      binary record signature - each rejects the other); juscar goes first
//      only because its marker is a precomputed boolean while this one scans
//      headerBytes at 188-byte stride.
//   9. freegps-70mai    - 70mai filename + hasFreeGpsMarker. Before the generic
//      freegps so a 70mai file is parsed with the 70mai ddmm*1e5 dialect, not
//      misread by the VIOFO Type-3 variant. Gated on the 70mai name so it never
//      touches VIOFO/Vantrue files.
//  10. freegps          - structural is cheap, streaming is the most expensive.
export const VIDEO_EMBEDDED_PRIMITIVES: readonly Primitive[] = [
    rvmiPrimitive,
    freeGpsBoxPrimitive,
    ligoGpsPrimitive,
    navitelTailPrimitive,
    autoVoxRiffPrimitive,
    gpsBox70maiPrimitive,
    garminUuidPrimitive,
    ligoJsonPrimitive,
    kenwoodPrimitive,
    ligoGpsTrailerPrimitive,
    gpsLogAtomPrimitive,
    nextbaseGdatPrimitive,
    gpmfPrimitive,
    wolfboxGpmdPrimitive,
    vantrueFmasPrimitive,
    roveGpmdPrimitive,
    roveSsmdPrimitive,
    sstarSsmdPrimitive,
    vueroidTxetPrimitive,
    pndmPrimitive,
    nextbaseSubtitlePrimitive,
    nmeaSubtitlePrimitive,
    gpsLogNbmtPrimitive,
    juscarTsPrimitive,
    novatekTsPrimitive,
    tsPesGpsPrimitive,
    freegps70maiPrimitive,
    freegpsPrimitive,
];

// Log-sidecar primitives: the format itself knows its own video (mp4Filename
// inside the row/header). Sidecars-by-basename (GPX, .map, .3gf) live in
// src/parsers/sidecars/ via SidecarHandler - they need knownVideos to match.
export const LOG_SIDECAR_PRIMITIVES: readonly Primitive[] = [csv70maiPrimitive];

export type { Primitive } from "./types.js";

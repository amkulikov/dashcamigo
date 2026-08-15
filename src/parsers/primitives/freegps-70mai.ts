// 70mai embedded freeGPS primitive (newer 4K models: A810, M500, ...). These
// drop the older $V02 CSV sidecar (csv-70mai) and embed a 70mai-dialect freeGPS
// block in the MP4. Byte layout + the timeless/position-only handling live in
// internal/freegps-70mai.ts.
//
// This is a SEPARATE primitive from the generic Novatek `freegps` (not just
// another FreeGpsVariant) because the semantics differ enough to warrant it:
// no per-record clock (records are emitted `timeUnsynced` and re-anchored),
// ddmm*1e5 int32 coordinates and a km/h speed field. Keeping it apart leaves
// the VIOFO per-block-UTC path untouched. The marker is gated on the 70mai
// filename so it never shadows VIOFO/Vantrue files - those fall through to
// `freegps`.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import { RX_70MAI } from "../filename/_patterns.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { streamScanFreeGps, tryStructuralPath } from "../internal/freegps.js";
import { finalize70maiRecords, parse70maiFreeGpsBlock } from "../internal/freegps-70mai.js";
import type { Primitive } from "./types.js";

export const freegps70maiPrimitive: Primitive = {
    id: "freegps-70mai",
    displayName: "70mai embedded freeGPS (A810/M500/4K)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // 70mai filename is required so this never competes with a VIOFO/Vantrue
        // file that also carries a freeGPS marker. Older 70mai (CSV) files
        // normally do not reach here: when their sidecar is present its records
        // already exist, so shouldTryEmbeddedGps skips the embedded probe; a
        // sidecar-less CSV-model file does reach here but has no freeGPS marker,
        // so hasFreeGpsMarker is false and the marker returns false.
        if (!RX_70MAI.test(file.file.name)) return false;
        return index.hasFreeGpsMarker === true;
    },

    async parse(file: VendorFile, index?: Mp4Index, signal?: AbortSignal): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("freegps-70mai requires Mp4Index");
        // Structural path first: A810 firmware writes an honest `gps ` index
        // atom inside moov (u32-BE offset/size pairs) pointing at every block,
        // so the shared table reader fetches only the blocks (~tens of KB)
        // instead of linearly scanning the whole 4K clip (~500 MB IO). We inject
        // the 70mai block parser; finalize collapses per-frame repeats exactly
        // as on the streaming path.
        const structural = await tryStructuralPath(file.file, index, parse70maiFreeGpsBlock, signal);
        if (structural) {
            const records = finalize70maiRecords(structural.records);
            if (records.length > 0) return { records, skipped: structural.skipped };
        }
        // Streaming fallback (M500 zeroes the atom, so novatekGpsAtom is null
        // there). Linear scan, no seedOffsets: 70mai writes one block per video
        // frame, densely spaced, so the predicted-offset jump scan - tuned for
        // sparse 1 Hz blocks - gives no benefit. The shared scanner handles
        // chunking, overlap and abort; we inject the 70mai block parser.
        const scanned = await streamScanFreeGps(file.file, signal, undefined, parse70maiFreeGpsBlock);
        const records = finalize70maiRecords(scanned.records);
        if (records.length === 0) {
            throw new WrongFormatError("70mai freeGPS markers found but no valid blocks");
        }
        return { records, skipped: scanned.skipped };
    },
};

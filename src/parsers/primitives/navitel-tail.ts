// Navitel tail-atom extractor. R-series and compatible Ambarella firmware
// write GPS in tail-atoms after moov (`IDIT` + `gpsa` + `gps0` +
// `gsea`+`gsen`). Parsing lives in internal/navitel-gps0.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import {
    GPS0_DATE_PROBE_BYTES,
    gps0HasSelfDescribedDates,
    parseGsenAtom,
    parseNavitelTail,
} from "../internal/navitel-gps0.js";
import type { Primitive } from "./types.js";

export const navitelTailPrimitive: Primitive = {
    id: "navitel-tail",
    displayName: "Navitel tail-atoms (Ambarella R-series)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index?.navitelGps0Atom) return false;
        // IDIT present: the known-good real-validated path (Navitel R600-1,
        // iBOX iCON) - IDIT supplies the year/month baseline.
        if (index.navitelIditAtom) return true;
        // IDIT-less acceptance: ExifTool's Process_gps0 (QuickTimeStream.pl:
        // 2715-2745, v13.59, "DuDuBell M1 / VSYS M6L") has no IDIT requirement
        // - records self-describe year/month at bytes 22-23. Implemented from
        // foreign source, not validated against a real IDIT-less sample (n=0);
        // accept only when the leading records actually carry plausible dates,
        // so zero-filled firmware (which needs the IDIT baseline) stays
        // rejected. Foreign gps0 dialects (Miltona, Lamax S9) can pass this
        // probe - parse() bails out on their signatures instead.
        const atom = index.navitelGps0Atom;
        const probeLen = Math.min(atom.size, GPS0_DATE_PROBE_BYTES);
        const probeBytes = new Uint8Array(await file.file.slice(atom.offset, atom.offset + probeLen).arrayBuffer());
        return gps0HasSelfDescribedDates(probeBytes);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("navitel-tail requires Mp4Index");
        if (!index.navitelGps0Atom) {
            throw new WrongFormatError("no gps0 tail-atom");
        }

        // IDIT is optional: when absent, parseNavitelTail requires the records
        // to self-describe their date (see the IDIT-less contract there).
        const iditBytes = index.navitelIditAtom
            ? new Uint8Array(
                  await file.file
                      .slice(index.navitelIditAtom.offset, index.navitelIditAtom.offset + index.navitelIditAtom.size)
                      .arrayBuffer(),
              )
            : null;
        const gps0Bytes = new Uint8Array(
            await file.file
                .slice(index.navitelGps0Atom.offset, index.navitelGps0Atom.offset + index.navitelGps0Atom.size)
                .arrayBuffer(),
        );

        const parsed = parseNavitelTail(iditBytes, gps0Bytes, file.file.name);
        if (!parsed) {
            throw new WrongFormatError(
                iditBytes
                    ? "gps0+IDIT present but produced no records"
                    : "gps0 without IDIT and records carry no usable self-described dates",
            );
        }

        // gsen sits next to gps0 in the same tail. Read only after gps0 has
        // produced records - accel is useless without them.
        const gsen = index.navitelGsenAtom;
        if (!gsen) return parsed;
        const gsenBytes = new Uint8Array(await file.file.slice(gsen.offset, gsen.offset + gsen.size).arrayBuffer());
        const accelSamples = parseGsenAtom(gsenBytes);
        return accelSamples.length > 0 ? { ...parsed, accelSamples } : parsed;
    },
};

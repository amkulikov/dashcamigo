// Plain-text GPS log in a top-level atom. Two atoms land here, both because
// upstream feeds them to a text parser rather than a binary one:
//
//  - `udat` (QuickTime.pm:900, v13.55) -> ProcessGPSLog, which tries NMEA
//    (written by Datakam Player software) and then the Denver bracketed
//    dialect. The name is one letter from the `udta` user-data atom and
//    unrelated to it.
//  - `nbmt` (Nextbase, QuickTimeStream.pl:2835-2856) -> Process_text, upstream's
//    generic text-dialect parser. Upstream documents NOTHING about the content,
//    so this is the most speculative carrier here: it is wired to the same
//    decoders, and a payload that is neither dialect is simply left unclaimed.
//
// Known limitation: the NMEA path is line-based, while upstream scans the whole
// buffer. A log written as one unbroken line would yield nothing here and the
// file would go unclaimed - a silent miss, never a misparse.

import { createLogger } from "../../log.js";
import type { ParsedRecords, VendorFile } from "../types.js";
import { dedupByUnixSeconds, parseNmeaText } from "./nmea.js";
import { hasDenverRecordStart, parseDenverGpsLog } from "./denver-gpslog.js";
import type { Mp4Index } from "./mp4-index.js";

const log = createLogger("parser:gpslog-atom");

// A 1 Hz log runs ~130 bytes/record, so this covers a day of driving. It exists
// to bound a corrupt size field, not to trim real logs - hence the warn.
const GPSLOG_MAX_BYTES = 4 * 1024 * 1024;

// Optional leading camera clock, exactly as upstream's `(?:\[(\d+)\])?`. Used
// only as a timestamp fallback - see the TIME RULE in nmea.ts.
const CAMERA_CLOCK_PREFIX_RX = /^\[(\d+)\]/;

// Any NMEA sentence, not just the RMC we decode. The head window covers the
// opening of the log, and a receiver dump opens with whatever its firmware
// emits first - upstream ProcessNMEA reads RMC and GGA, and real dumps lead
// with GGA/GSA/GSV as often as with RMC. Gating on RMC alone would drop such a
// file with no diagnostic; the two error costs are not symmetric here, since a
// false positive only spends the no-winner probe retry lap.
const NMEA_SENTENCE_RX = /\$[A-Z]{2}[A-Z]{3},/;

type LogAtom = NonNullable<Mp4Index["topLevelUdatAtom"]>;

/**
 * Which carrier atom a caller is interested in. They are split because their
 * primitives sit at different points of the walk - see the registration
 * comments in primitives/index.ts.
 */
export type TextLogAtomKind = "udat" | "nbmt";

const ALL_TEXT_LOG_ATOMS: readonly TextLogAtomKind[] = ["udat", "nbmt"];

/** The requested text-log atoms of an index, in the order they are tried. */
export function textGpsLogAtoms(index: Mp4Index, kinds: readonly TextLogAtomKind[] = ALL_TEXT_LOG_ATOMS): LogAtom[] {
    const atoms: LogAtom[] = [];
    if (kinds.includes("udat") && index.topLevelUdatAtom) atoms.push(index.topLevelUdatAtom);
    if (kinds.includes("nbmt") && index.topLevelNbmtAtom) atoms.push(index.topLevelNbmtAtom);
    return atoms;
}

/**
 * Whether an atom head (read during indexing) looks like one of the dialects.
 * Content-based on purpose: the dispatch gate uses this to decide that no
 * freeGPS probe is needed, so "the atom exists" is not enough - a file could
 * carry unrelated bytes there and its real GPS elsewhere.
 */
export function hasUdatGpsLogHead(head: Uint8Array): boolean {
    const text = new TextDecoder("latin1").decode(head);
    return NMEA_SENTENCE_RX.test(text) || hasDenverRecordStart(text);
}

/**
 * True when any of the requested text-log atoms carries a recognizable head.
 * Defaults to both carriers - that is what the dispatcher's kind gate needs,
 * where "some primitive can claim this file" is the question.
 */
export function hasTextGpsLogAtom(index: Mp4Index, kinds: readonly TextLogAtomKind[] = ALL_TEXT_LOG_ATOMS): boolean {
    return textGpsLogAtoms(index, kinds).some((atom) => atom.head !== null && hasUdatGpsLogHead(atom.head));
}

/**
 * Reads and decodes the first of the requested text-log atoms that yields
 * records. Returns null when none does.
 */
export async function tryExtractTextGpsLog(
    file: VendorFile,
    index: Mp4Index,
    kinds: readonly TextLogAtomKind[] = ALL_TEXT_LOG_ATOMS,
): Promise<ParsedRecords | null> {
    for (const atom of textGpsLogAtoms(index, kinds)) {
        if (!atom.head || !hasUdatGpsLogHead(atom.head)) continue;
        const text = await readAtomText(file, atom);
        if (text === null) continue;

        const nmea = parseNmeaText(text, file.file.name, {
            linePrefixRegex: CAMERA_CLOCK_PREFIX_RX,
            linePrefixOptional: true,
        });
        if (nmea.records.length > 0) {
            return { records: dedupByUnixSeconds(nmea.records), skipped: nmea.skipped };
        }

        const denver = parseDenverGpsLog(text, file.file.name);
        if (denver) return denver;
    }
    return null;
}

/** Atom payload as latin1 text, trailing NUL padding stripped (as upstream). */
async function readAtomText(file: VendorFile, atom: LogAtom): Promise<string | null> {
    if (atom.size <= atom.headerSize) return null;
    const payloadStart = atom.offset + atom.headerSize;
    const payloadEnd = atom.offset + atom.size;
    const readEnd = Math.min(payloadStart + GPSLOG_MAX_BYTES, payloadEnd);
    if (readEnd < payloadEnd) {
        log.warn("text GPS log truncated at read cap - tail of the track is lost", {
            payloadBytes: payloadEnd - payloadStart,
            readBytes: readEnd - payloadStart,
        });
    }

    try {
        const buf = await file.file.slice(payloadStart, readEnd).arrayBuffer();
        return new TextDecoder("latin1").decode(buf).replace(/\0+$/, "");
    } catch {
        return null;
    }
}

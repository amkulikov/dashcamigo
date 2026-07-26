// BlackVue X-series free-with-gps extraction. Capability-agnostic utility
// wrapped by the free-gps-box primitive. Structure: top-level free box before
// moov containing a nested `gps ` box with NMEA payload (see
// ../primitives/free-gps-box.ts for cprt/ptnm details). This file handles GPS
// extraction only.

import type { AccelSample, ParsedRecords, VendorFile } from "../types.js";
import { dedupByUnixSeconds, parseNmeaText } from "./nmea.js";
import { parseDenverGpsLog } from "./denver-gpslog.js";
import type { Mp4Index } from "./mp4-index.js";
import { parse3gfBuffer } from "../sidecars/blackvue-3gf.js";

// Same camera-clock prefix as the legacy `.gps` sidecar. Required here (strict
// mode) so a stray non-NMEA line inside the box is dropped; it does not time the
// records - see the TIME RULE in nmea.ts.
const BLACKVUE_PREFIX_RX = /^\[(\d{13})\]/;

/**
 * Extracts NMEA records from the `gps ` box inside the top-level free box
 * (already located in Mp4Index). Returns null if the box is absent.
 * The `vf` parameter exists for signature compatibility with other tryExtract*
 * functions; everything needed is already in index.freeBoxView.
 */
export async function tryExtractFreeGpsBox(vf: VendorFile, index: Mp4Index): Promise<ParsedRecords | null> {
    const gpsBox = index.freeGpsBoxInsideFree;
    if (!gpsBox) return null;
    const dv = index.freeBoxView;
    if (!dv) return null;

    const payloadBytes = new Uint8Array(
        dv.buffer,
        dv.byteOffset + gpsBox.payloadStart,
        gpsBox.end - gpsBox.payloadStart,
    );
    const text = new TextDecoder("latin1").decode(payloadBytes);

    const result = parseNmeaText(text, vf.file.name, {
        linePrefixRegex: BLACKVUE_PREFIX_RX,
    });
    if (result.records.length === 0) {
        // Same two decoders in the same order as upstream's ProcessGPSLog: this
        // `gps ` child is one of the two atoms a Denver-style bracketed log is
        // known to arrive in. Costs one regex pass on a payload we already hold,
        // and only on files where the NMEA path found nothing.
        const denver = parseDenverGpsLog(text, vf.file.name);
        if (!denver) return null;
        return { ...denver, accelSamples: readEmbedded3gf(index) };
    }

    return {
        records: dedupByUnixSeconds(result.records),
        skipped: result.skipped,
        accelSamples: readEmbedded3gf(index),
    };
}

/**
 * Reads the `3gf ` sibling of the `gps ` box - the accelerometer stream on
 * BlackVue models that ship no `.3gf` sidecar file. Byte layout is identical
 * to the sidecar (verified against a real DR550DW standalone `.3gf`: big
 * endian, /128 scale, 0xFFFFFFFF ms sentinel), so the sidecar's parser is
 * reused rather than duplicated.
 *
 * Returns undefined when the box is absent or carries no samples - the
 * samples-vs-nothing distinction is what the dispatcher keys on, and an empty
 * array would just add a dead map entry.
 *
 * Note these samples are inert on a GPS-less file: mergeAccelSamples attaches
 * to existing GpsRecords, and this extractor only runs when the `gps ` sibling
 * produced some.
 */
function readEmbedded3gf(index: Mp4Index): AccelSample[] | undefined {
    const box = index.free3gfBoxInsideFree;
    const dv = index.freeBoxView;
    if (!box || !dv) return undefined;
    // Copied out rather than viewed in place: parse3gfBuffer takes an
    // ArrayBuffer, and the free-box view may sit on a shared buffer.
    const payload = new Uint8Array(dv.buffer, dv.byteOffset + box.payloadStart, box.end - box.payloadStart).slice();
    const samples = parse3gfBuffer(payload.buffer);
    return samples.length > 0 ? samples : undefined;
}

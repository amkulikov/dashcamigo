import { fillForwardBearings, haversineKm } from "../../parser.js";
import type { GpsRecord, ParsedRecords, VendorFile } from "../types.js";
import { getFirstSampleOfTrack, type Mp4Index, type TrackInfo } from "./mp4-index.js";
import { loadSamples, readFirstSampleEntry, readSampleTable } from "./mp4-walker.js";

const SAMPLE_SIZE = 40;
const MAX_IMPLIED_SPEED_MS = 80;

function hasPacketHeader(view: DataView): boolean {
    return (
        view.byteLength === SAMPLE_SIZE &&
        view.getUint32(0) === 36 &&
        view.getUint16(4) === 0x4e01 &&
        view.getUint16(6) === 0xf000 &&
        view.getUint16(16) === 0xff04
    );
}

function isFixPacket(view: DataView): boolean {
    const longitudeHemisphere = view.getUint8(18);
    const latitudeHemisphere = view.getUint8(19);
    return (
        (longitudeHemisphere === 0x45 || longitudeHemisphere === 0x57) &&
        (latitudeHemisphere === 0x4e || latitudeHemisphere === 0x53) &&
        view.getUint8(20) === 1
    );
}

function isNoFixPacket(view: DataView): boolean {
    return view.getUint8(18) === 0 && view.getUint8(19) === 0 && view.getUint8(20) === 2;
}

export async function findSeiDoubleGpsTrack(file: VendorFile, index: Mp4Index): Promise<TrackInfo | null> {
    if (!index.moovView) return null;
    for (const track of index.tracks) {
        if (!hasSeiDoubleGpsTrackShape(index, track)) continue;
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first || first.byteLength !== SAMPLE_SIZE) continue;
        const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
        if (hasPacketHeader(view) && (isFixPacket(view) || isNoFixPacket(view))) return track;
    }
    return null;
}

export function hasSeiDoubleGpsTrackShape(index: Mp4Index, track: TrackInfo): boolean {
    return (
        index.moovView !== null &&
        track.handlerType === "vide" &&
        track.sampleFormat === "hvc1" &&
        readFirstSampleEntry(index.moovView, track.trakBox)?.size === SAMPLE_SIZE
    );
}

export async function extractSeiDoubleGps(
    file: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
    signal?: AbortSignal,
): Promise<ParsedRecords | null> {
    if (!index.moovView) return null;
    const samples = readSampleTable(index.moovView, track.trakBox);
    if (!samples?.length || samples.some((sample) => sample.size !== SAMPLE_SIZE)) return null;
    const buffers = await loadSamples(file.file, samples, index.sliceCost);
    const records: GpsRecord[] = [];
    const skipped: ParsedRecords["skipped"] = [];
    let matchedPackets = 0;
    let lastCounter = -1;
    const baseUnix = index.createdUtc?.getTime() ?? file.file.lastModified;

    for (let i = 0; i < buffers.length; i++) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const view = new DataView(buffers[i]!);
        if (!hasPacketHeader(view) || (!isFixPacket(view) && !isNoFixPacket(view))) {
            skipped.push({ line: i + 1, raw: `<sei sample ${i + 1}>`, reason: "invalid sei gps packet" });
            continue;
        }
        matchedPackets++;
        // The packet counter advances in real seconds. This firmware gives
        // its second packet a 66 ms MP4 PTS despite a two-second GPS step.
        const counter = view.getUint16(8);
        if (counter <= lastCounter) {
            skipped.push({ line: i + 1, raw: `<sei sample ${i + 1}>`, reason: "nonmonotonic gps counter" });
            continue;
        }
        lastCounter = counter;
        if (isNoFixPacket(view)) continue;

        const lonMagnitude = view.getFloat64(21, true);
        const latMagnitude = view.getFloat64(29, true);
        const lon = view.getUint8(18) === 0x57 ? -Math.abs(lonMagnitude) : Math.abs(lonMagnitude);
        const lat = view.getUint8(19) === 0x53 ? -Math.abs(latMagnitude) : Math.abs(latMagnitude);
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            (lat === 0 && lon === 0) ||
            Math.abs(lat) > 90 ||
            Math.abs(lon) > 180
        ) {
            skipped.push({ line: i + 1, raw: `<sei sample ${i + 1}>`, reason: "invalid gps coordinates" });
            continue;
        }
        const unixSeconds = baseUnix / 1000 + counter;
        const previous = records.at(-1);
        const dt = previous ? unixSeconds - previous.unixSeconds : 0;
        const impliedSpeedMs = previous && dt > 0 ? (haversineKm(previous.lat, previous.lon, lat, lon) * 1000) / dt : 0;
        const speedMs = impliedSpeedMs <= MAX_IMPLIED_SPEED_MS ? impliedSpeedMs : 0;
        records.push({
            unixSeconds,
            active: true,
            lat,
            lon,
            bearingDeg: 0,
            speedMs,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: file.file.name,
            // Packets have relative time, not a satellite UTC clock. The
            // trip layer anchors them after it chooses the video's start.
            timeUnsynced: true,
            relStartSeconds: counter,
        });
    }
    if (matchedPackets < Math.ceil(buffers.length / 2)) return null;
    if (records.length > 1) records[0]!.speedMs = records[1]!.speedMs;
    fillForwardBearings(records);
    return { records, skipped };
}

import { type Box, findBox, iterBoxes, readHandlerType, readMediaTimescale } from "../parsers/internal/mp4-walker.js";

export interface MseVideoTrackMetadata {
    trackId: number;
    timescale: number;
    defaultSampleDuration?: number;
    defaultSampleFlags?: number;
}

export interface MseVideoFragmentMetadata {
    keyframeTimestamps: number[];
    endSec: number | null;
}

const MAX_FRAGMENT_SAMPLES = 10_000_000;

function malformed(): never {
    throw new Error("invalid fragmented mp4 timing metadata");
}

function requireBytes(box: Box, offset: number, count: number): void {
    if (offset < box.payloadStart || offset + count > box.end) malformed();
}

function children(dv: DataView, start: number, end: number): Box[] {
    const boxes = [...iterBoxes(dv, start, end)];
    if ((boxes.at(-1)?.end ?? start) !== end) malformed();
    return boxes;
}

function requiredBox(dv: DataView, parent: Box, type: string): Box {
    const boxes = children(dv, parent.payloadStart, parent.end);
    if (boxes.filter((box) => box.type === type).length !== 1) malformed();
    return findBox(dv, parent.payloadStart, parent.end, type)!;
}

function rootBox(bytes: Uint8Array, type: string): { dv: DataView; box: Box } {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxes = children(dv, 0, dv.byteLength);
    if (boxes.length !== 1 || boxes[0]!.type !== type) malformed();
    return { dv, box: boxes[0]! };
}

function fullBox(dv: DataView, box: Box, versions: number[], allowedFlags = 0): number {
    requireBytes(box, box.payloadStart, 4);
    const value = dv.getUint32(box.payloadStart);
    const flags = value & 0xffffff;
    if (!versions.includes(value >>> 24) || (flags & ~allowedFlags) !== 0) malformed();
    return flags;
}

/** Reads the video clock and defaults from a complete muxed initialization moov. */
export function readVideoTrackMetadata(bytes: Uint8Array): MseVideoTrackMetadata {
    const { dv, box: moov } = rootBox(bytes, "moov");
    const tracks = children(dv, moov.payloadStart, moov.end).filter((box) => box.type === "trak");
    const videoTracks = tracks.filter((track) => readHandlerType(dv, track) === "vide");
    if (videoTracks.length !== 1) malformed();
    const track = videoTracks[0]!;
    const tkhd = requiredBox(dv, track, "tkhd");
    fullBox(dv, tkhd, [0, 1], 0xf);
    const idOffset = tkhd.payloadStart + (dv.getUint8(tkhd.payloadStart) === 1 ? 20 : 12);
    requireBytes(tkhd, idOffset, 4);
    const trackId = dv.getUint32(idOffset);
    const mdhd = requiredBox(dv, requiredBox(dv, track, "mdia"), "mdhd");
    fullBox(dv, mdhd, [0, 1]);
    const timescale = readMediaTimescale(dv, track);
    if (trackId === 0 || !timescale) malformed();

    const metadata: MseVideoTrackMetadata = { trackId, timescale };
    const mvex = requiredBox(dv, moov, "mvex");
    for (const trex of children(dv, mvex.payloadStart, mvex.end)) {
        if (trex.type !== "trex") continue;
        fullBox(dv, trex, [0]);
        requireBytes(trex, trex.payloadStart, 24);
        if (dv.getUint32(trex.payloadStart + 4) !== trackId) continue;
        if (metadata.defaultSampleDuration !== undefined) malformed();
        metadata.defaultSampleDuration = dv.getUint32(trex.payloadStart + 12);
        metadata.defaultSampleFlags = dv.getUint32(trex.payloadStart + 20);
    }
    return metadata;
}

function checkedTime(value: number): number {
    if (!Number.isSafeInteger(value)) malformed();
    return value;
}

/** Reads actual video samples; audio-only fragments do not advance the video clock. */
export function readVideoFragmentMetadata(bytes: Uint8Array, track: MseVideoTrackMetadata): MseVideoFragmentMetadata {
    const { dv, box: moof } = rootBox(bytes, "moof");
    if (!Number.isSafeInteger(track.timescale) || track.timescale <= 0) malformed();
    const result: MseVideoFragmentMetadata = { keyframeTimestamps: [], endSec: null };
    for (const traf of children(dv, moof.payloadStart, moof.end)) {
        if (traf.type !== "traf") continue;
        const tfhd = requiredBox(dv, traf, "tfhd");
        const tfhdFlags = fullBox(dv, tfhd, [0], 0x03003b);
        requireBytes(tfhd, tfhd.payloadStart + 4, 4);
        if (dv.getUint32(tfhd.payloadStart + 4) !== track.trackId) continue;
        let cursor = tfhd.payloadStart + 8;
        if (tfhdFlags & 0x000001) cursor += 8;
        if (tfhdFlags & 0x000002) cursor += 4;
        let defaultDuration = track.defaultSampleDuration;
        let defaultFlags = track.defaultSampleFlags;
        if (tfhdFlags & 0x000008) {
            requireBytes(tfhd, cursor, 4);
            defaultDuration = dv.getUint32(cursor);
            cursor += 4;
        }
        if (tfhdFlags & 0x000010) cursor += 4;
        if (tfhdFlags & 0x000020) {
            requireBytes(tfhd, cursor, 4);
            defaultFlags = dv.getUint32(cursor);
            cursor += 4;
        }
        if (cursor !== tfhd.end) malformed();

        const tfdt = requiredBox(dv, traf, "tfdt");
        fullBox(dv, tfdt, [0, 1]);
        const isLongTime = dv.getUint8(tfdt.payloadStart) === 1;
        requireBytes(tfdt, tfdt.payloadStart + 4, isLongTime ? 8 : 4);
        let decodeTime = checkedTime(
            isLongTime ? Number(dv.getBigUint64(tfdt.payloadStart + 4)) : dv.getUint32(tfdt.payloadStart + 4),
        );
        const runs = children(dv, traf.payloadStart, traf.end).filter((box) => box.type === "trun");
        if (runs.length === 0 && !(tfhdFlags & 0x010000)) malformed();
        for (const trun of runs) {
            const flags = fullBox(dv, trun, [0, 1], 0x000f05);
            if (flags & 0x000004 && flags & 0x000400) malformed();
            requireBytes(trun, trun.payloadStart + 4, 4);
            const count = dv.getUint32(trun.payloadStart + 4);
            if (count > MAX_FRAGMENT_SAMPLES || (tfhdFlags & 0x010000 && count !== 0)) malformed();
            cursor = trun.payloadStart + 8;
            if (flags & 0x000001) cursor += 4;
            let firstFlags = defaultFlags;
            if (flags & 0x000004) {
                requireBytes(trun, cursor, 4);
                firstFlags = dv.getUint32(cursor);
                cursor += 4;
            }
            const sampleFieldCount = [0x100, 0x200, 0x400, 0x800].filter((flag) => flags & flag).length;
            if (cursor + count * sampleFieldCount * 4 !== trun.end) malformed();
            for (let i = 0; i < count; i++) {
                let duration = defaultDuration;
                let sampleFlags = i === 0 ? firstFlags : defaultFlags;
                let compositionOffset = 0;
                if (flags & 0x000100) {
                    duration = dv.getUint32(cursor);
                    cursor += 4;
                }
                if (flags & 0x000200) cursor += 4;
                if (flags & 0x000400) {
                    sampleFlags = dv.getUint32(cursor);
                    cursor += 4;
                }
                if (flags & 0x000800) {
                    compositionOffset =
                        dv.getUint8(trun.payloadStart) === 1 ? dv.getInt32(cursor) : dv.getUint32(cursor);
                    cursor += 4;
                }
                if (duration === undefined || sampleFlags === undefined) malformed();
                const presentationTime = checkedTime(decodeTime + compositionOffset);
                const endSec = checkedTime(presentationTime + duration) / track.timescale;
                if (!(sampleFlags & 0x00010000) && ((sampleFlags >>> 24) & 3) !== 1) {
                    result.keyframeTimestamps.push(presentationTime / track.timescale);
                }
                result.endSec = Math.max(result.endSec ?? Number.NEGATIVE_INFINITY, endSec);
                decodeTime = checkedTime(decodeTime + duration);
            }
        }
    }
    return result;
}

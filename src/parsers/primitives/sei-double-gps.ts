import type { Mp4Index } from "../internal/mp4-index.js";
import { extractSeiDoubleGps, findSeiDoubleGpsTrack } from "../internal/sei-double-gps.js";
import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Primitive } from "./types.js";

export const seiDoubleGpsPrimitive: Primitive = {
    id: "sei-double-gps",
    displayName: "HEVC SEI double GPS track",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        return index ? (await findSeiDoubleGpsTrack(file, index)) !== null : false;
    },

    async parse(file: VendorFile, index?: Mp4Index, signal?: AbortSignal): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("sei double gps requires mp4 index");
        const track = await findSeiDoubleGpsTrack(file, index);
        if (!track) throw new WrongFormatError("no sei double gps track");
        const result = await extractSeiDoubleGps(file, index, track, signal);
        if (!result) throw new WrongFormatError("sei gps track has no matching packets");
        return result;
    },
};

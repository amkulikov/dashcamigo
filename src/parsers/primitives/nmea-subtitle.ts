// GPS-in-subtitle extractor for Thinkware F-series. Two firmware dialects:
// F200 PRO / F800 Pro write ";"-delimited "gsensori,...;GxRMC(no $),...;CAR,..."
// cues; older F770/F750 write "$GxRMC"/"$GSENSOR" separated by `\0`. Both are
// decoded in internal/sbtl-nmea-extract.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromNmeaSubtitleTrack, findNmeaSubtitleTrack } from "../internal/sbtl-nmea-extract.js";
import type { Primitive } from "./types.js";

export const nmeaSubtitlePrimitive: Primitive = {
    id: "nmea-subtitle",
    displayName: "GPS-in-subtitle (Thinkware F-series)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        const track = await findNmeaSubtitleTrack(file, index);
        return track !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("nmea-subtitle requires Mp4Index");
        const track = await findNmeaSubtitleTrack(file, index);
        if (!track) {
            throw new WrongFormatError("no subtitle/text/meta track with NMEA");
        }
        const result = await extractFromNmeaSubtitleTrack(file, index, track);
        if (!result) {
            throw new WrongFormatError("subtitle track contains no valid GPRMC records");
        }
        return result;
    },
};

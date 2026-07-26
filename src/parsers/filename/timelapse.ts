// Filename technique: is this a TIME-LAPSE recording? A time-lapse clip captures
// frames far slower than it plays back, so it is time-compressed - its duration
// and the burnt-in clock do NOT track real elapsed wall time (a 2-minute park
// becomes a ~9-second clip). The viewer surfaces this as a badge and marks the
// on-screen clock, because otherwise the displayed time crawls at playback rate
// and misleads.
//
// This is ORTHOGONAL to RecordingMode: a 70mai A510 "LA" clip is BOTH parking
// (mode) AND time-lapse, so it gets its own boolean field rather than a mode
// value. Filename-driven on purpose - a GPS-density heuristic
// (fixes-per-video-second) looks tempting but false-positives on genuine
// high-rate GPS (GoPro GPMF logs 10-18 Hz), so only an explicit vendor
// time-lapse marker is trusted.

import { RX_70MAI, RX_70MAI_PATH_MODE, RX_70MAI_PREFIX_MODE, RX_DDPAI_TIMELAPSE } from "./_patterns.js";
import type { VendorFile } from "../types.js";
import type { FilenameTechnique } from "./types.js";

// 70mai A510 parking time-lapse. Mirrors mai70Mode's LA branch (which folds LA
// into the "parking" mode slot): the "Lapse/" folder on a foldered drop, or the
// LA filename prefix on a flat drop (gated on RX_70MAI so the two-letter prefix
// cannot claim a foreign "LA...mp4").
const mai70Timelapse: FilenameTechnique<boolean> = {
    id: "70mai-timelapse",
    extract(file: VendorFile): boolean | null {
        const pm = file.relativePath.match(RX_70MAI_PATH_MODE);
        if (pm && pm[1]!.toLowerCase() === "lapse") return true;
        if (!RX_70MAI.test(file.file.name)) return null;
        const prefix = file.file.name.match(RX_70MAI_PREFIX_MODE);
        return prefix && prefix[1]!.toUpperCase() === "LA" ? true : null;
    },
};

// DDPai time-lapse parking clips (S_/Q_ name variant, RX_DDPAI_TIMELAPSE).
const ddpaiTimelapse: FilenameTechnique<boolean> = {
    id: "ddpai-timelapse",
    extract(file: VendorFile): boolean | null {
        return RX_DDPAI_TIMELAPSE.test(file.file.name) ? true : null;
    },
};

export const FILENAME_TIMELAPSE: readonly FilenameTechnique<boolean>[] = [mai70Timelapse, ddpaiTimelapse];

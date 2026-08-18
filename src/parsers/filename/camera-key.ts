// Cross-channel camera key techniques.
//
// Each technique returns a string that is IDENTICAL for every channel of one
// physical camera (front + rear + interior + side) and DIFFERENT for separate
// cameras of the same model. The dispatcher in trips.ts uses this key to isolate
// distinct cameras in groupTrips: two cameras dropped together with close
// timestamps will no longer collapse into one frame.
//
// Algorithm per technique:
//   1. Recognise the format (same regex as the time/channel techniques).
//   2. Strip the channel marker from the filename (e.g. the trailing F/B/I
//      letter, or the S/Q prefix) so a single masked-name is shared by channels.
//   3. Strip the channel folder from `parentDir` (e.g. Front/Back/Interior,
//      normal/a, /rear/) so the path prefix is also shared.
//   4. Compose: `${id}|${strippedDir}|${maskedName}`. The id prefix isolates
//      formats so an unfamiliar generic .mp4 cannot collide with a Navitel
//      one that happens to mask to the same string.
//
// Files that no technique recognises fall back to the plain `cameraFingerprint`
// (mask + parentDir as-is). Those files are not cross-channel aware.

import type { VendorFile } from "../types.js";
import {
    MAI70_MODE_FOLDERS,
    REDTIGER_MODE_FOLDERS,
    RX_70MAI,
    RX_70MAI_CHANNEL_STRIP,
    RX_BEFERICH,
    RX_BLACKVUE,
    RX_CARCAM,
    RX_DDPAI_EVENT,
    RX_DDPAI_NORMAL,
    RX_DDPAI_TIMELAPSE,
    RX_E_ACE,
    RX_ESCORT,
    RX_FITCAMX,
    RX_FITCAMX_MP4,
    RX_FORD,
    RX_HPIM,
    RX_IBOX,
    RX_JUSCAR,
    RX_MOV_SEQ_FRI,
    RX_NAVITEL,
    RX_NEOLINE,
    RX_NEXTBASE,
    RX_NOVATEK_SINGLE,
    RX_NOVATEK_TS,
    RX_NOVATEK_VANTRUE,
    RX_NOVATEK_VIOFO,
    RX_REC_SINGLE,
    RX_REDTIGER,
    RX_SSTAR_CHN,
    RX_TESLA_EVENT_FILENAME,
    RX_TESLA_PATH,
    RX_TESLA_RECENT,
    RX_THINKWARE,
    RX_VUEROID,
    RX_WOLFBOX,
} from "./_patterns.js";
import type { FilenameCameraKeyTechnique } from "./types.js";

/**
 * Returns the parent-directory string with channel-folder segments stripped.
 *
 * Walks the path bottom-up from the file's parent, dropping consecutive
 * segments that match any of `channelFolders` (case-insensitive). Returns
 * the remaining join. Empty path or flat-drop -> "".
 *
 * Stripping is iterative so layouts like `normal/a/` (CarCam: parent folder
 * is `a`, grandparent is `normal`) collapse to `` rather than just to `normal`
 * - the whole channel sub-tree is one logical "channel marker".
 */
function strippedParentDir(relativePath: string, channelFolders: readonly string[]): string {
    const segs = relativePath.split("/").filter((s) => s.length > 0);
    if (segs.length < 2) return ""; // flat drop, no parent
    const dirSegs = segs.slice(0, -1); // drop the filename itself
    const lower = channelFolders.map((s) => s.toLowerCase());
    while (dirSegs.length > 0) {
        const last = dirSegs[dirSegs.length - 1]!.toLowerCase();
        if (!lower.includes(last)) break;
        dirSegs.pop();
    }
    return dirSegs.join("/");
}

/**
 * Removes a single character at `idx` from `name`, then masks every digit
 * run with `#`. Used to strip a channel letter that sits at a known
 * regex-capture position.
 */
function maskNameWithCharRemoved(name: string, idx: number): string {
    const stripped = idx >= 0 ? name.slice(0, idx) + name.slice(idx + 1) : name;
    return stripped.replace(/\d+/g, "#");
}

/**
 * Strips a single trailing channel letter that sits immediately before the
 * extension (e.g. `..._F.mp4`), then digit-masks. Locates the letter via the
 * same `<letter>.` right-anchored search every trailing-letter family uses, so
 * all channels of one camera converge to one masked name. Not for the Nextbase
 * `_<channel><quality>.` layout, which anchors differently.
 */
function maskNameWithTrailingLetterStripped(name: string, channelChar: string): string {
    const idx = name.toLowerCase().lastIndexOf(`${channelChar.toLowerCase()}.`);
    return maskNameWithCharRemoved(name, idx);
}

/**
 * Plain digit-mask (no character stripped). Exported so cameraFingerprint's
 * fallback path (for filenames that no technique recognises) uses the same
 * masking rule as the technique outputs.
 */
export function maskName(name: string): string {
    return name.replace(/\d+/g, "#");
}

// Channel folders (Front/Back/Rear/Interior) AND recording-mode folders
// (MAI70_MODE_FOLDERS, shared with RX_70MAI_PATH_MODE) both strip from the
// 70mai parent path. Layout is `.../<Mode>/<Channel>/<file>`: the mode folder
// sits ABOVE the channel folder, so strippedParentDir's bottom-up walk pops the
// channel segment first, then the mode segment. Both are per-clip attributes,
// not camera identity - an event clip must land in the same trip as its normal
// siblings (the A810 lite interleaves them). Scoped to mai70CameraKey; other
// vendors keep their own strip sets.
const MAI70_STRIP_FOLDERS = ["front", "back", "rear", "interior", ...MAI70_MODE_FOLDERS];

const mai70CameraKey: FilenameCameraKeyTechnique = {
    id: "70mai-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_70MAI.test(file.file.name)) return null;
        // Strip the channel letter from either position RX_70MAI accepts
        // (terminal, or before the app-export 14-digit stamp). The shared
        // right-anchored `<letter>.` helper only finds the terminal slot, so
        // the strip regex lives next to RX_70MAI in _patterns.ts (same tail
        // grammar, one owner) and is self-gating - no channel letter, no-op.
        const stripped = file.file.name.replace(RX_70MAI_CHANNEL_STRIP, "$1");
        let masked = maskName(stripped);
        // Canonicalize the EV/LA/PA prefixes to NO (normal): the prefix is a
        // per-clip recording mode, not camera identity. The A810 lite
        // interleaves EV clips inside the normal loop (an event fires and it
        // writes the EV clip INSTEAD of the normal segment), and the A510 does
        // the same with LA/PA parking clips - so every mode-prefixed clip must
        // share the fingerprint of its NO twin to chain into one trip by time.
        // Masking only touches digits, so the leading prefix survives it; fold
        // it here, keeping the "NO#-#.MP#" shape so diagnostics stay
        // recognizable.
        masked = masked.replace(/^(?:EV|LA|PA)/i, "NO");
        // Strip both "back" and "rear" (multi-channel drops rear in Back/, the
        // A810 lite in Rear/) plus the recording-mode folder above the channel
        // one, so Normal/Front, Normal/Rear, Event/Front, Event/Rear all yield
        // the same dir component.
        const dir = strippedParentDir(file.relativePath, MAI70_STRIP_FOLDERS);
        return `70mai|${dir}|${masked}`;
    },
};

const beferichCameraKey: FilenameCameraKeyTechnique = {
    id: "beferich-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_BEFERICH);
        if (!m) return null;
        // Channel letter at group [7], one char before `.mp4`. Strip it so
        // front + rear converge to one fingerprint and pair into one frame.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[7]!);
        // Single-folder corpus; defensive strip for hand-split channels.
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior"]);
        return `beferich|${dir}|${masked}`;
    },
};

const blackvueCameraKey: FilenameCameraKeyTechnique = {
    id: "blackvue-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_BLACKVUE);
        if (!m) return null;
        // Channel char at group [4], one char before `.mp4`. The mode char [3]
        // sits right before it; we strip only the channel.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[4]!);
        // BlackVue typically writes everything to one folder, but defensive strip
        // for users who manually split channels into subfolders.
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior"]);
        return `blackvue|${dir}|${masked}`;
    },
};

const carcamCameraKey: FilenameCameraKeyTechnique = {
    id: "carcam-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_CARCAM);
        if (!m) return null;
        // Channel letter A/B/C/D at group [4], in `-X.mp4` position.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[4]!);
        // CarCam path layout: `normal/a|b|c|d/...`. The channel folder name is
        // a single letter; strip it (and the `normal` parent stays as-is).
        const dir = strippedParentDir(file.relativePath, ["a", "b", "c", "d"]);
        return `carcam|${dir}|${masked}`;
    },
};

const sstarChnCameraKey: FilenameCameraKeyTechnique = {
    id: "sstar-chn-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_SSTAR_CHN.test(file.file.name)) return null;
        // The channel index lives in the leading `CH<n>` token AND in a
        // per-channel `CH<n>` folder (Normal/CH1|CH2|CH3/). Digit-masking already
        // folds CH1/CH2/CH3 -> CH# in the name (the index is a digit), so only
        // the folder must be stripped for all channels to converge on one
        // fingerprint and pair into one multichannel frame. Mode folders
        // (Normal/Event) are NOT stripped - like CarCam, keep event clips as
        // their own trip until a real sample shows the firmware interleaves them.
        const dir = strippedParentDir(file.relativePath, ["ch1", "ch2", "ch3", "ch4"]);
        return `sstar-chn|${dir}|${maskName(file.file.name)}`;
    },
};

const recSingleCameraKey: FilenameCameraKeyTechnique = {
    id: "rec-single-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_REC_SINGLE.test(file.file.name)) return null;
        // Single-channel: no channel marker to strip from name or path.
        const dir = strippedParentDir(file.relativePath, []);
        return `rec-single|${dir}|${maskName(file.file.name)}`;
    },
};

const ddpaiCameraKey: FilenameCameraKeyTechnique = {
    id: "ddpai-camera-key",
    extract(file: VendorFile): string | null {
        const name = file.file.name;
        // Normal: optional `_A` rear suffix at group [3]. Strip it AND its leading underscore.
        const normal = name.match(RX_DDPAI_NORMAL);
        if (normal) {
            let stripped = name;
            if (normal[3]) {
                stripped = stripped.replace(/_[Aa](\.mp4)$/i, "$1");
            }
            const dir = strippedParentDir(file.relativePath, ["front", "rear", "inside"]);
            return `ddpai|${dir}|${maskName(stripped)}`;
        }
        // Timelapse: S_ (front) / Q_ (rear) prefix at group [1].
        const tl = name.match(RX_DDPAI_TIMELAPSE);
        if (tl) {
            const stripped = name.replace(/^[SsQq]_/, "");
            const dir = strippedParentDir(file.relativePath, ["front", "rear", "inside"]);
            return `ddpai|${dir}|tl:${maskName(stripped)}`;
        }
        // Event: G_ prefix is mode (not channel - events are front-only).
        // Keep name as-is so DDPai events do not collide with normal/timelapse.
        const ev = name.match(RX_DDPAI_EVENT);
        if (ev) {
            const dir = strippedParentDir(file.relativePath, ["front", "rear", "inside"]);
            return `ddpai|${dir}|ev:${maskName(name)}`;
        }
        return null;
    },
};

const eaceCameraKey: FilenameCameraKeyTechnique = {
    id: "e-ace-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_E_ACE);
        if (!m) return null;
        // Optional F/R channel suffix at group [3], immediately before `.mp4`.
        let masked: string;
        const ch = m[3];
        if (ch) {
            masked = maskNameWithTrailingLetterStripped(file.file.name, ch);
        } else {
            masked = maskName(file.file.name);
        }
        const dir = strippedParentDir(file.relativePath, ["front", "rear"]);
        return `e-ace|${dir}|${masked}`;
    },
};

const escortCameraKey: FilenameCameraKeyTechnique = {
    id: "escort-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_ESCORT.test(file.file.name)) return null;
        // M2 is single-channel; no channel marker to strip. Mode lives in path
        // (Normal/Event/Favorites) - those should NOT be stripped, otherwise
        // Normal and Event clips of the same camera collapse into a single trip
        // boundary, which is not what we want for the channel-key concept.
        const dir = strippedParentDir(file.relativePath, []);
        return `escort|${dir}|${maskName(file.file.name)}`;
    },
};

const FITCAMX_STRIP_FOLDERS = ["movie", "movie_e", "emr", "emr_e"];

const fitcamxCameraKey: FilenameCameraKeyTechnique = {
    id: "fitcamx-camera-key",
    extract(file: VendorFile): string | null {
        const name = file.file.name;
        // MP4 variant: the 3-letter suffix ends in <channel><mode letter>.
        // Both are per-clip attributes, not camera identity - the corpus shows
        // EMR clips running the uninterrupted minute cadence of a normal loop
        // (event written INSTEAD of the normal segment, the redtiger
        // rationale), and the .ts branch below already strips the mode FOLDER
        // for the same reason. Drop both letters so the A/B pair and the
        // normal/event siblings all converge on one key.
        if (RX_FITCAMX_MP4.test(name)) {
            const suffixStart = name.length - ".mp4".length - 2;
            const stripped = name.slice(0, suffixStart) + name.slice(suffixStart + 2);
            const masked = maskName(stripped);
            const dir = strippedParentDir(file.relativePath, FITCAMX_STRIP_FOLDERS);
            return `fitcamx|${dir}|${masked}`;
        }
        if (!RX_FITCAMX.test(name)) return null;
        // .ts variant: channel comes purely from parent folder (Movie/Movie_E/
        // EMR/EMR_E). Strip the channel/mode folder; nothing to remove from
        // the name itself.
        const dir = strippedParentDir(file.relativePath, FITCAMX_STRIP_FOLDERS);
        return `fitcamx|${dir}|${maskName(name)}`;
    },
};

const fordCameraKey: FilenameCameraKeyTechnique = {
    id: "ford-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_FORD);
        if (!m) return null;
        // Channel letter at group [7], one char before `.ts`. Strip it (anchored
        // to the same RX_FORD match, not a second pattern that could drift from
        // it) so every channel of one camera converges to a single fingerprint -
        // front + rear (+ any other) then pair into one multichannel frame in
        // groupTrips. Same lastIndexOf+mask approach as the other trailing-letter
        // families (juscar/ibox/...).
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[7]!);
        // Ford writes all channels into one folder, but strip spelled-out channel
        // folders too in case a user splits them by hand.
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior"]);
        return `ford|${dir}|${masked}`;
    },
};

// HP card layout is `<Mode>/<channel letter>/<file>` (Normal/F/...). Both
// levels are per-clip attributes, not camera identity: strippedParentDir's
// bottom-up walk pops the single-letter channel folder first, then the mode
// folder above it (the mai70 rationale - an event clip written mid-loop must
// chain into the same trip as its normal siblings). Event/Parking/Manual are
// the standard CarDV set; an unknown mode folder simply stays in the key and
// degrades to a per-folder trip split, same as before this technique.
const HPIM_STRIP_FOLDERS = ["f", "r", "b", "i", "normal", "event", "parking", "manual"];

const hpimCameraKey: FilenameCameraKeyTechnique = {
    id: "hpim-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_HPIM);
        if (!m) return null;
        // Channel letter at group [3], one char before `.TS`. Strip it so all
        // channels of one camera converge on one fingerprint.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[3]!);
        const dir = strippedParentDir(file.relativePath, HPIM_STRIP_FOLDERS);
        return `hpim|${dir}|${masked}`;
    },
};

const iboxCameraKey: FilenameCameraKeyTechnique = {
    id: "ibox-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_IBOX);
        if (!m) return null;
        // Channel letter F/R/I at group [5], immediately before `.mp4|.mov`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[5]!);
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior"]);
        return `ibox|${dir}|${masked}`;
    },
};

const juscarCameraKey: FilenameCameraKeyTechnique = {
    id: "juscar-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_JUSCAR);
        if (!m) return null;
        // Channel letter F/R at group [3], immediately before `.ts`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[3]!);
        // Juscar splits channels by folder too (video/front/, video/rear/).
        const dir = strippedParentDir(file.relativePath, ["front", "rear"]);
        return `juscar|${dir}|${masked}`;
    },
};

const movSeqFriCameraKey: FilenameCameraKeyTechnique = {
    id: "mov-seq-fri-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_MOV_SEQ_FRI);
        if (!m) return null;
        // Channel letter F/R/I at group [3], immediately before the extension.
        // Strip it so all channels of one capture converge on one fingerprint
        // and pair into one multichannel frame (the interior clip starts a
        // couple seconds behind front/rear; the groupTrips snap absorbs that).
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[3]!);
        // The .ts card splits channels into single-letter F/ R/ folders - a
        // per-clip attribute, not camera identity; long names cover
        // hand-split channels.
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior", "f", "r", "i"]);
        return `mov-seq-fri|${dir}|${masked}`;
    },
};

const NAVITEL_STRIP_FOLDERS = ["front", "rear", "f", "r", "normal", "event", "parking", "manual"];

const navitelCameraKey: FilenameCameraKeyTechnique = {
    id: "navitel-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_NAVITEL);
        if (!m) return null;
        // Optional channel letter at group [8], one char before extension.
        let masked: string;
        const ch = m[8];
        if (ch) {
            masked = maskNameWithTrailingLetterStripped(file.file.name, ch);
        } else {
            masked = maskName(file.file.name);
        }
        // The .ts variant lays the card out as `<Mode>/<channel letter>/`
        // (Normal/F/, Normal/R/) - the hpim layout, same strip rationale:
        // both levels are per-clip attributes, not camera identity, and an
        // event clip written mid-loop must chain into the same trip as its
        // normal siblings. Spelled-out names cover hand-split channels.
        const dir = strippedParentDir(file.relativePath, NAVITEL_STRIP_FOLDERS);
        return `navitel|${dir}|${masked}`;
    },
};

const novatekViofoCameraKey: FilenameCameraKeyTechnique = {
    id: "novatek-viofo-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_NOVATEK_VIOFO);
        if (!m) return null;
        // Channel letter F/R/T/I at group [6], one char before `.mp4`. The
        // mode letter [5] (P = parking, E = impact event) stays in the mask
        // (cameraKey is not mode-aware - mode handling lives separately).
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[6]!);
        // "ro" is the locked-clip folder (firmware moves locked clips into
        // Movie/RO/ with unchanged names) - strip it so a locked clip keeps
        // the fingerprint of its Movie/ siblings; otherwise per-fingerprint
        // TZ buckets split and the locked frame renders as a second "camera".
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior", "ro"]);
        return `novatek-viofo|${dir}|${masked}`;
    },
};

const novatekVantrueCameraKey: FilenameCameraKeyTechnique = {
    id: "novatek-vantrue-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_NOVATEK_VANTRUE);
        if (!m) return null;
        // Channel letter A/B/C at group [5], one char before `.mp4`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[5]!);
        const dir = strippedParentDir(file.relativePath, ["front", "rear", "interior"]);
        return `novatek-vantrue|${dir}|${masked}`;
    },
};

const novatekSingleCameraKey: FilenameCameraKeyTechnique = {
    id: "novatek-single-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_NOVATEK_SINGLE.test(file.file.name)) return null;
        // Single-channel: no channel marker to strip. "ro" is the locked-clip
        // folder (see novatekViofoCameraKey) - strip it so locked and normal
        // clips of one camera share a fingerprint.
        const dir = strippedParentDir(file.relativePath, ["ro"]);
        return `novatek-single|${dir}|${maskName(file.file.name)}`;
    },
};

const novatekTsCameraKey: FilenameCameraKeyTechnique = {
    id: "novatek-ts-camera-key",
    extract(file: VendorFile): string | null {
        if (!RX_NOVATEK_TS.test(file.file.name)) return null;
        // Single-channel in the corpus: no channel marker to strip.
        const dir = strippedParentDir(file.relativePath, []);
        return `novatek-ts|${dir}|${maskName(file.file.name)}`;
    },
};

const neolineCameraKey: FilenameCameraKeyTechnique = {
    id: "neoline-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_NEOLINE);
        if (!m) return null;
        // Channel letter F/R at group [4], immediately before `.mp4`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[4]!);
        const dir = strippedParentDir(file.relativePath, ["front", "rear"]);
        return `neoline|${dir}|${masked}`;
    },
};

const vueroidCameraKey: FilenameCameraKeyTechnique = {
    id: "vueroid-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_VUEROID);
        if (!m) return null;
        // The channel letter F/R (group [3]) sits mid-name (`_F_N.mp4`), not
        // before the extension, so the shared trailing-letter helper cannot
        // find it - strip via a replace anchored to the same
        // `_<channel>_<mode>.mp4` tail RX_VUEROID matched. The N/E/P mode
        // letter is folded to N: mode is a per-clip attribute, not camera
        // identity - an event clip written mid-loop must share the fingerprint
        // of its N siblings to chain into one trip (the mai70 EV/LA/PA
        // rationale; E/P shapes are corpus-unvalidated, folding is the safe
        // direction either way).
        const stripped = file.file.name.replace(/_[FR]_[NEP](\.mp4)$/i, "_N$1");
        const dir = strippedParentDir(file.relativePath, ["front", "rear"]);
        return `vueroid|${dir}|${maskName(stripped)}`;
    },
};

const nextbaseCameraKey: FilenameCameraKeyTechnique = {
    id: "nextbase-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_NEXTBASE);
        if (!m) return null;
        // Strip ONLY the channel letter [4]; KEEP the H/L quality letter [5].
        // Nextbase records parallel high/low-bitrate streams of the same lens
        // with identical timestamps - collapsing H+L into one fingerprint
        // would put the L stream on an already-occupied channel slot and
        // spawn |dupN frames. A user dropping both H and L streams therefore
        // sees two parallel trips - deliberate, the safe degradation.
        const lower = file.file.name.toLowerCase();
        // `_<channel><quality>.` anchors the channel letter position; +1
        // skips the underscore so only the channel letter is removed.
        const idx = lower.lastIndexOf(`_${m[4]!.toLowerCase()}${m[5]!.toLowerCase()}.`) + 1;
        const masked = maskNameWithCharRemoved(file.file.name, idx);
        const dir = strippedParentDir(file.relativePath, []);
        return `nextbase|${dir}|${masked}`;
    },
};

// RedTiger splits channels into sibling `<mode>_<channel letter>` folders
// (Movie_F/, Movie_R/, Event_F/, ...). Both the folder and the trailing letter
// are per-clip attributes, not camera identity: the corpus shows an event pair
// slotted exactly into the 3-minute loop cadence between its Movie neighbours
// (the firmware writes the event clip INSTEAD of the normal segment), so an
// Event clip must chain into the same trip as its Movie siblings - the
// mai70/hpim rationale.
const REDTIGER_STRIP_FOLDERS = REDTIGER_MODE_FOLDERS.flatMap((mode) =>
    ["f", "r"].map((channelLetter) => `${mode}_${channelLetter}`),
);

const redtigerCameraKey: FilenameCameraKeyTechnique = {
    id: "redtiger-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_REDTIGER);
        if (!m) return null;
        // Channel letter at group [3], one char before `.MP4`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[3]!);
        const dir = strippedParentDir(file.relativePath, REDTIGER_STRIP_FOLDERS);
        return `redtiger|${dir}|${masked}`;
    },
};

const teslaCameraKey: FilenameCameraKeyTechnique = {
    id: "tesla-camera-key",
    extract(file: VendorFile): string | null {
        const lower = file.relativePath.toLowerCase();
        if (!RX_TESLA_PATH.test(lower)) return null;
        // RecentClips: timestamp is in the filename; SavedClips/SentryClips:
        // timestamp is in the parent folder (already cross-channel - all
        // cameras of one event share the same timestamp folder).
        const recent = file.file.name.match(RX_TESLA_RECENT);
        const evt = file.file.name.match(RX_TESLA_EVENT_FILENAME);
        if (!recent && !evt) return null;
        const segs = file.relativePath.split("/").filter((s) => s.length > 0);
        // Walk up past the file (1 level) and past the timestamp folder
        // (1 level for event clips; recent layout is `RecentClips/<name>` so
        // the parent is `RecentClips` itself).
        const top = segs.length >= 2 ? segs.slice(0, -1).join("/") : "";
        if (recent) {
            // `<x>/<y>-front.mp4` -> camera key for the whole RecentClips folder.
            // Stripping the cam suffix from the filename. recent[7] is the cam.
            const cam = recent[7]!;
            const stripped = file.file.name.replace(new RegExp(`-${cam}\\.mp4$`, "i"), ".mp4");
            return `tesla|${top}|${maskName(stripped)}`;
        }
        // Event: filename IS the camera name; strip it entirely so all
        // cameras of one event share the same key.
        return `tesla|${top}|event`;
    },
};

const thinkwareCameraKey: FilenameCameraKeyTechnique = {
    id: "thinkware-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_THINKWARE);
        if (!m) return null;
        // Channel letter F/R at group [2], one char before `.mp4`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[2]!);
        const dir = strippedParentDir(file.relativePath, ["front", "rear"]);
        return `thinkware|${dir}|${masked}`;
    },
};

// Wolfbox SD layout splits channels into sibling `<channel>_<mode>` folders,
// so both the trailing letter AND the folder must be stripped for the
// cross-channel key to converge.
const WOLFBOX_CHANNEL_FOLDERS = ["front", "rear", "extra"].flatMap((ch) =>
    ["norm", "emer", "photo"].map((mode) => `${ch}_${mode}`),
);

const wolfboxCameraKey: FilenameCameraKeyTechnique = {
    id: "wolfbox-camera-key",
    extract(file: VendorFile): string | null {
        const m = file.file.name.match(RX_WOLFBOX);
        if (!m) return null;
        // Channel letter F/I/R at group [6], one char before `.mp4`.
        const masked = maskNameWithTrailingLetterStripped(file.file.name, m[6]!);
        const dir = strippedParentDir(file.relativePath, WOLFBOX_CHANNEL_FOLDERS);
        return `wolfbox|${dir}|${masked}`;
    },
};

/**
 * Camera-key techniques in walk order. Each returns a cross-channel string
 * or null when the format does not match.
 *
 * `cameraFingerprint` (in camera-fingerprint.ts) walks this list and falls
 * back to a plain mask+parentDir when nothing matches. Order is by specificity
 * - the wide `e-ace` regex (any `\d{8}_\d{6}[FR]?\.mp4`) comes after the
 * narrower neighbours to keep diagnostics stable.
 */
export const FILENAME_CAMERA_KEY: readonly FilenameCameraKeyTechnique[] = [
    mai70CameraKey,
    beferichCameraKey,
    blackvueCameraKey,
    carcamCameraKey,
    sstarChnCameraKey,
    recSingleCameraKey,
    ddpaiCameraKey,
    novatekViofoCameraKey,
    novatekVantrueCameraKey,
    novatekSingleCameraKey,
    novatekTsCameraKey,
    eaceCameraKey,
    escortCameraKey,
    fitcamxCameraKey,
    fordCameraKey,
    hpimCameraKey,
    iboxCameraKey,
    juscarCameraKey,
    movSeqFriCameraKey,
    navitelCameraKey,
    neolineCameraKey,
    nextbaseCameraKey,
    redtigerCameraKey,
    teslaCameraKey,
    thinkwareCameraKey,
    vueroidCameraKey,
    wolfboxCameraKey,
];

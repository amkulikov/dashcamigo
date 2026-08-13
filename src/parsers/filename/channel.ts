// Filename channel techniques. One entry = one way to map filename/path to a
// ChannelMatch ({ channel, confident }). Walk picks first non-null.
//
// Many techniques look at a single capital letter just before the extension;
// the mapping (F=front, B=rear vs F=front, R=rear) differs per family, so
// they live as distinct entries.
//
// `confident` separates two kinds of letters (see ChannelMatch doc):
//   - mnemonic (F=front, R=rear, B=back, I=interior) under a vendor-specific
//     name pattern, or a spelled-out path/folder, or a single-channel model
//     -> confident (UI shows "Rear camera").
//   - index letters whose mapping is a pure vendor convention (CarCam A/B/C/D,
//     Vantrue A/B/C where B=cabin) -> not confident (UI shows "Channel N").

import type { Channel, VendorFile } from "../types.js";
import {
    RX_70MAI,
    RX_70MAI_PATH_CHANNEL,
    RX_BEFERICH,
    RX_BLACKVUE,
    RX_CARCAM,
    RX_CARCAM_PATH_FRONT,
    RX_CARCAM_PATH_INTERIOR,
    RX_CARCAM_PATH_REAR,
    RX_CARCAM_PATH_SIDE,
    RX_DDPAI_EVENT,
    RX_DDPAI_NORMAL,
    RX_DDPAI_TIMELAPSE,
    RX_E_ACE,
    RX_FITCAMX_PATH_FRONT,
    RX_FITCAMX_PATH_REAR,
    RX_FORD,
    RX_HPIM,
    RX_IBOX,
    RX_JUSCAR,
    RX_JUSCAR_PATH_FRONT,
    RX_JUSCAR_PATH_REAR,
    RX_MOV_SEQ_FRI,
    RX_NAVITEL,
    RX_NEOLINE,
    RX_NEXTBASE,
    RX_NOVATEK_SINGLE,
    RX_NOVATEK_VANTRUE,
    RX_NOVATEK_VIOFO,
    RX_SSTAR_CHN,
    RX_TESLA_EVENT_FILENAME,
    RX_TESLA_PATH,
    RX_TESLA_RECENT,
    RX_THINKWARE,
    RX_VUEROID,
    RX_WOLFBOX,
    RX_WOLFBOX_PATH_FRONT,
    RX_WOLFBOX_PATH_INTERIOR,
    RX_WOLFBOX_PATH_REAR,
} from "./_patterns.js";
import type { ChannelMatch, FilenameChannelTechnique } from "./types.js";

// Trustworthy mount: vendor-specific mnemonic letter, spelled-out path, or
// single-channel model. UI shows the semantic label.
const sure = (channel: Channel): ChannelMatch => ({ channel, confident: true });
// Best-effort mount from an index letter (A/B/C/D) - used for layout/grouping,
// but the UI shows a positional "Channel N" label instead of asserting a mount.
const guess = (channel: Channel): ChannelMatch => ({ channel, confident: false });

const mai70Channel: FilenameChannelTechnique = {
    id: "70mai-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_70MAI);
        if (m) {
            // The letter sits either before the trailing 14-digit stamp (m[8],
            // app-export shape) or at the very end (m[9]); one file carries at
            // most one of the two.
            const suffix = m[8] ?? m[9];
            if (suffix !== undefined) {
                const ch = suffix.toUpperCase();
                if (ch === "F") return sure("front");
                // B and R both mean rear: the older multi-channel models (S500/
                // A810/T800) suffix the rear file B, the A810 lite uses R. A given
                // unit uses one or the other, never both, so they cannot collide
                // on the rear slot within one camera.
                if (ch === "B" || ch === "R") return sure("rear");
                if (ch === "I") return sure("interior");
            }
        }
        // Multi-channel S500/A810/T800 use Normal/Front, Normal/Back, Normal/Interior.
        const pm = file.relativePath.match(RX_70MAI_PATH_CHANNEL);
        if (pm) {
            const folder = pm[1]!.toLowerCase();
            if (folder === "front") return sure("front");
            if (folder === "back") return sure("rear");
            if (folder === "interior") return sure("interior");
        }
        return null;
    },
};

const beferichChannel: FilenameChannelTechnique = {
    id: "beferich-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_BEFERICH);
        if (!m) return null;
        // `f` = front is confirmed on real J18 samples. The rest of the map is
        // the ford-channel rationale verbatim: standard mnemonics for r/b/i
        // (the dual-channel firmware is expected to suffix the rear `r`), any
        // other letter goes to the FREE "side" slot as a guess so it still
        // pairs with front in one frame without colliding with a real rear.
        switch (m[7]!.toLowerCase()) {
            case "f":
                return sure("front");
            case "r":
            case "b":
                return sure("rear");
            case "i":
                return sure("interior");
            default:
                return guess("side");
        }
    },
};

const blackvueChannel: FilenameChannelTechnique = {
    id: "blackvue-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_BLACKVUE);
        if (!m) return null;
        const ch = m[4]!.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        if (ch === "I") return sure("interior");
        return null;
    },
};

const carcamChannel: FilenameChannelTechnique = {
    id: "carcam-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_CARCAM);
        if (m) {
            // A/B/C/D are index letters: the mount mapping is CarCam's own
            // convention, not a mnemonic. Use it for layout, but don't assert it.
            switch (m[4]!.toUpperCase()) {
                case "A":
                    return guess("front");
                case "B":
                    return guess("rear");
                case "C":
                    return guess("interior");
                case "D":
                    return guess("side");
            }
        }
        // Path-based fallback: Normal/A/, Normal/B/, ... - the vendor laid the
        // files out in named folders, a deliberate signal we trust.
        const lower = file.relativePath.toLowerCase();
        if (RX_CARCAM_PATH_FRONT.test(lower)) return sure("front");
        if (RX_CARCAM_PATH_REAR.test(lower)) return sure("rear");
        if (RX_CARCAM_PATH_INTERIOR.test(lower)) return sure("interior");
        if (RX_CARCAM_PATH_SIDE.test(lower)) return sure("side");
        return null;
    },
};

const sstarChnChannel: FilenameChannelTechnique = {
    id: "sstar-chn-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_SSTAR_CHN);
        if (!m) return null;
        // CH1/CH2/CH3(/CH4) are index markers (SigmaStar reference-design
        // naming), not mnemonics - the mount mapping is a best guess, so the UI
        // shows a positional "Channel N" label until confirmed. CH1 is the
        // high-bitrate main lens (front); the CH2/CH3 order (rear vs cabin) is
        // unverified. Same treatment as CarCam A/B/C/D.
        switch (m[1]) {
            case "1":
                return guess("front");
            case "2":
                return guess("rear");
            case "3":
                return guess("interior");
            case "4":
                return guess("side");
        }
        return null;
    },
};

const ddpaiChannel: FilenameChannelTechnique = {
    id: "ddpai-channel",
    extract(file: VendorFile): ChannelMatch | null {
        // A=rear is a DDPai convention (not a mnemonic), and RX_DDPAI_NORMAL is
        // a generic timestamp pattern, so the mount is a guess. Same for the
        // S/Q timelapse letters and the event default-to-front.
        const normal = file.file.name.match(RX_DDPAI_NORMAL);
        if (normal) return normal[3] === "A" || normal[3] === "a" ? guess("rear") : guess("front");
        const tl = file.file.name.match(RX_DDPAI_TIMELAPSE);
        if (tl) return tl[1]!.toUpperCase() === "Q" ? guess("rear") : guess("front");
        const ev = file.file.name.match(RX_DDPAI_EVENT);
        if (ev) return guess("front");
        // Path-based fallback for 3-channel models (Z90 Master 3CH) - spelled-out folders.
        const lower = file.relativePath.toLowerCase();
        if (lower.includes("/front/")) return sure("front");
        if (lower.includes("/rear/")) return sure("rear");
        if (lower.includes("/inside/")) return sure("interior");
        return null;
    },
};

const eaceChannel: FilenameChannelTechnique = {
    id: "e-ace-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_E_ACE);
        if (!m) return null;
        const ch = m[3]?.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        // No suffix - single-channel model; grouper assigns default 'front'.
        return null;
    },
};

const fitcamxChannel: FilenameChannelTechnique = {
    id: "fitcamx-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const path = file.relativePath;
        if (RX_FITCAMX_PATH_REAR.test(path)) return sure("rear");
        if (RX_FITCAMX_PATH_FRONT.test(path)) return sure("front");
        return null;
    },
};

const fordChannel: FilenameChannelTechnique = {
    id: "ford-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_FORD);
        if (!m) return null;
        // `f` = front is confirmed on a real sample. The other channels are
        // unconfirmed (front-only corpus): map the standard mnemonics, and treat
        // any other letter as a distinct non-front channel so it pairs with front
        // in one frame (same fingerprint, see ford-camera-key) instead of
        // defaulting to "front". An unknown letter goes to the FREE "side" slot,
        // NOT "rear": the confident mnemonics already own front/rear/interior, so
        // "rear" would collide with a real `_r`/`_b` in the same frame and spawn a
        // |dupN split (and demote the confirmed rear's label - finalizeTrip in
        // trips.ts treats a guessed channel as not-confident). Same reasoning as
        // novatek-viofo (T -> side) and nextbase (B -> interior). Guessed mount
        // -> positional UI label regardless of the slot.
        switch (m[7]!.toLowerCase()) {
            case "f":
                return sure("front");
            case "r":
            case "b":
                return sure("rear");
            case "i":
                return sure("interior");
            default:
                return guess("side");
        }
    },
};

const hpimChannel: FilenameChannelTechnique = {
    id: "hpim-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_HPIM);
        if (!m) return null;
        // `f` = front is corpus-confirmed. The other letters follow the ford
        // rationale: standard mnemonics for r/b/i, any other letter goes to
        // the FREE "side" slot as a guess so it still pairs with front in one
        // frame without colliding with a real rear.
        switch (m[3]!.toLowerCase()) {
            case "f":
                return sure("front");
            case "r":
            case "b":
                return sure("rear");
            case "i":
                return sure("interior");
            default:
                return guess("side");
        }
    },
};

const iboxChannel: FilenameChannelTechnique = {
    id: "ibox-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_IBOX);
        if (!m) return null;
        const ch = m[5]!.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        if (ch === "I") return sure("interior");
        return null;
    },
};

const juscarChannel: FilenameChannelTechnique = {
    id: "juscar-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_JUSCAR);
        if (m) {
            const letter = m[3]!.toUpperCase();
            if (letter === "F") return sure("front");
            if (letter === "R") return sure("rear");
        }
        const path = file.relativePath;
        if (RX_JUSCAR_PATH_REAR.test(path)) return sure("rear");
        if (RX_JUSCAR_PATH_FRONT.test(path)) return sure("front");
        return null;
    },
};

const neolineChannel: FilenameChannelTechnique = {
    id: "neoline-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_NEOLINE);
        if (!m) return null;
        const ch = m[4]!.toUpperCase();
        if (ch === "F") return sure("front");
        // R = rear is an assumption (the corpus is front-only), but it is a
        // standard mnemonic under a vendor-specific pattern - same treatment
        // as the unconfirmed Ford letters.
        if (ch === "R") return sure("rear");
        return null;
    },
};

const vueroidChannel: FilenameChannelTechnique = {
    id: "vueroid-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_VUEROID);
        if (!m) return null;
        const ch = m[3]!.toUpperCase();
        if (ch === "F") return sure("front");
        // R = rear is an assumption (front-only corpus), mnemonic-backed -
        // same treatment as neoline/ford.
        if (ch === "R") return sure("rear");
        return null;
    },
};

const navitelChannel: FilenameChannelTechnique = {
    id: "navitel-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_NAVITEL);
        if (!m) return null;
        const suffix = m[8];
        if (!suffix) return null;
        const ch = suffix.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        return null;
    },
};

const movSeqFriChannel: FilenameChannelTechnique = {
    id: "mov-seq-fri-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_MOV_SEQ_FRI);
        if (!m) return null;
        // F/R/I are standard mnemonics under a tightly gated shape -> sure()
        // per the mnemonic rule above, even though the corpus is
        // filename-only (see RX_MOV_SEQ_FRI).
        switch (m[3]!.toUpperCase()) {
            case "F":
                return sure("front");
            case "R":
                return sure("rear");
            case "I":
                return sure("interior");
        }
        return null;
    },
};

const novatekViofoChannel: FilenameChannelTechnique = {
    id: "novatek-viofo-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_NOVATEK_VIOFO);
        if (!m) return null;
        const ch = m[6]!.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        if (ch === "I") return sure("interior");
        // T = telephoto, a third front-facing lens (viofosync
        // web/services/naming.py:99-107: "3-channel models pair F+R with
        // either T or I"). Map it to the free "side" slot so it cannot
        // collide with the F file of the same capture on one channel slot
        // (which would spawn |dupN frames); guess() because "side" is a
        // positional compromise, not the actual mount. Implemented from
        // foreign source (viofosync), no real T sample in the corpus.
        if (ch === "T") return guess("side");
        return null;
    },
};

const novatekSingleChannel: FilenameChannelTechnique = {
    id: "novatek-single-channel",
    extract(file: VendorFile): ChannelMatch | null {
        // Single-channel model - only one camera, nothing to confuse.
        return RX_NOVATEK_SINGLE.test(file.file.name) ? sure("front") : null;
    },
};

const novatekVantrueChannel: FilenameChannelTechnique = {
    id: "novatek-vantrue-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_NOVATEK_VANTRUE);
        if (!m) return null;
        // A/B/C are index letters (B=cabin is not a mnemonic) - guess the mount.
        const ch = m[5]!.toUpperCase();
        if (ch === "A") return guess("front");
        if (ch === "B") return guess("interior"); // Vantrue B = cabin
        if (ch === "C") return guess("rear");
        return null;
    },
};

const nextbaseChannel: FilenameChannelTechnique = {
    id: "nextbase-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_NEXTBASE);
        if (!m) return null;
        const ch = m[4]!.toUpperCase();
        if (ch === "F") return sure("front");
        if (ch === "R") return sure("rear");
        // B is a module letter whose mount nb-dashcam-tools never states (it
        // treats it as an opaque token; could be the Cabin View module or a
        // rear-window one). Guess "interior" so it cannot collide with R on
        // one channel slot; guess() keeps the UI positional instead of
        // asserting a mount we are only guessing.
        if (ch === "B") return guess("interior");
        return null;
    },
};

const teslaChannel: FilenameChannelTechnique = {
    id: "tesla-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const lower = file.relativePath.toLowerCase();
        if (!RX_TESLA_PATH.test(lower)) return null;
        const recent = file.file.name.match(RX_TESLA_RECENT);
        const evt = file.file.name.match(RX_TESLA_EVENT_FILENAME);
        const camera = recent ? recent[7]!.toLowerCase() : evt ? evt[1]!.toLowerCase() : null;
        if (!camera) return null;
        // Tesla spells the camera out in the name/path - trustworthy.
        switch (camera) {
            case "front":
                return sure("front");
            case "back":
                return sure("rear");
            case "cabin":
                return sure("interior");
            case "left_repeater":
            case "right_repeater":
            case "left_pillar":
            case "right_pillar":
                return sure("side");
        }
        return null;
    },
};

const thinkwareChannel: FilenameChannelTechnique = {
    id: "thinkware-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_THINKWARE);
        if (!m) return null;
        return m[2]!.toUpperCase() === "F" ? sure("front") : sure("rear");
    },
};

const wolfboxChannel: FilenameChannelTechnique = {
    id: "wolfbox-channel",
    extract(file: VendorFile): ChannelMatch | null {
        const m = file.file.name.match(RX_WOLFBOX);
        if (m) {
            const ch = m[6]!.toUpperCase();
            if (ch === "F") return sure("front");
            if (ch === "R") return sure("rear");
            if (ch === "I") return sure("interior");
        }
        // SD-card folders spell the channel out (front_norm/rear_emer/...);
        // `extra` is the interior camera on the 3-channel models.
        const path = file.relativePath;
        if (RX_WOLFBOX_PATH_FRONT.test(path)) return sure("front");
        if (RX_WOLFBOX_PATH_REAR.test(path)) return sure("rear");
        if (RX_WOLFBOX_PATH_INTERIOR.test(path)) return sure("interior");
        return null;
    },
};

export const FILENAME_CHANNEL: readonly FilenameChannelTechnique[] = [
    // neoline/vueroid are name-gated exact shapes and must precede the
    // techniques with un-gated path fallbacks (70mai's Front|Back|Interior,
    // ddpai's /front|rear|inside/): a user who splits channels into folders
    // must still get the letter from the name, not a foreign path claim.
    // Safe at the front: both return null for any other name.
    neolineChannel,
    vueroidChannel,
    mai70Channel,
    beferichChannel,
    blackvueChannel,
    carcamChannel,
    sstarChnChannel,
    ddpaiChannel,
    novatekViofoChannel,
    novatekVantrueChannel,
    novatekSingleChannel,
    eaceChannel,
    fitcamxChannel,
    fordChannel,
    hpimChannel,
    iboxChannel,
    juscarChannel,
    movSeqFriChannel,
    navitelChannel,
    nextbaseChannel,
    teslaChannel,
    thinkwareChannel,
    wolfboxChannel,
];

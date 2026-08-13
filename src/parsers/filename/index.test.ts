// Smoke tests for the per-field filename walks.
// Specific-pattern correctness is exercised by the higher-level
// pipeline / fixture tests; here we just verify the walk picks the right
// technique by matchedId and that classify* shortcuts return the value.

import { describe, expect, it } from "vitest";

import { cameraFingerprint } from "../camera-fingerprint.js";
import type { VendorFile } from "../types.js";
import {
    RX_70MAI,
    RX_DDPAI_NORMAL,
    RX_FORD,
    RX_HPIM,
    RX_MIVUE,
    RX_MOV_SEQ_FRI,
    RX_NEOLINE,
    RX_REC_SINGLE,
    RX_VUEROID,
} from "./_patterns.js";
import {
    classifyFilenameChannel,
    classifyFilenameMode,
    classifyFilenameSequence,
    classifyFilenameTime,
    classifyFilenameTimelapse,
    matchFilenameChannel,
    matchFilenameMode,
    matchFilenameSequence,
    matchFilenameTime,
} from "./index.js";

function vf(name: string, relativePath: string = name): VendorFile {
    return { file: new File([new Uint8Array(0)], name), relativePath };
}

describe("matchFilenameTime", () => {
    it("70mai-time wins on NO-prefix", () => {
        const r = matchFilenameTime(vf("NO20240429-182640F.MP4"));
        expect(r.matchedId).toBe("70mai-time");
        expect(r.value?.getUTCFullYear()).toBe(2024);
        expect(r.value?.getUTCMonth()).toBe(3); // April
        expect(r.value?.getUTCDate()).toBe(29);
    });

    it("blackvue-time on YYYYMMDD_HHMMSS_NF pattern", () => {
        const r = matchFilenameTime(vf("20211011_141314_NF.mp4"));
        expect(r.matchedId).toBe("blackvue-time");
        expect(r.value?.getUTCHours()).toBe(14);
    });

    it("generic-datetime is the last fallback", () => {
        // Filename that matches no specific family but contains a datetime token.
        const r = matchFilenameTime(vf("clip-2024-04-29-18-26-40.bin"));
        expect(r.matchedId).toBe("generic-datetime");
    });

    it("null + null matchedId for unrecognised name", () => {
        const r = matchFilenameTime(vf("random.bin"));
        expect(r.value).toBeNull();
        expect(r.matchedId).toBeNull();
    });
});

describe("matchFilenameChannel", () => {
    it("70mai F suffix -> front, confident (vendor-specific mnemonic)", () => {
        const r = matchFilenameChannel(vf("NO20240429-182640F.MP4"));
        expect(r.matchedId).toBe("70mai-channel");
        expect(r.value).toEqual({ channel: "front", confident: true });
    });

    it("70mai B suffix -> rear (B=rear is 70mai mapping), confident", () => {
        const r = matchFilenameChannel(vf("NO20240429-182640B.MP4"));
        expect(r.value).toEqual({ channel: "rear", confident: true });
    });

    it("Carcam A suffix -> front but NOT confident (index letter, vendor convention)", () => {
        const r = matchFilenameChannel(vf("REC20250607-180617-527-A.mp4"));
        expect(r.matchedId).toBe("carcam-channel");
        expect(r.value).toEqual({ channel: "front", confident: false });
    });

    it("Carcam D suffix -> side, not confident", () => {
        expect(matchFilenameChannel(vf("REC20250607-180617-527-D.mp4")).value).toEqual({
            channel: "side",
            confident: false,
        });
    });

    it("Carcam path Normal/A -> front, confident (named folder is a deliberate signal)", () => {
        // No A/B/C/D suffix in the name, so the path-based branch decides.
        const r = matchFilenameChannel(vf("REC20250607-180617-527.mp4", "Normal/A/REC20250607-180617-527.mp4"));
        expect(r.matchedId).toBe("carcam-channel");
        expect(r.value).toEqual({ channel: "front", confident: true });
    });

    it("SStar CH1/CH2/CH3 -> front/rear/interior, NOT confident (index, mount is a guess)", () => {
        const c1 = matchFilenameChannel(vf("CH1-20260618-130336.TS"));
        expect(c1.matchedId).toBe("sstar-chn-channel");
        expect(c1.value).toEqual({ channel: "front", confident: false });
        expect(matchFilenameChannel(vf("CH2-20260618-130336.TS")).value).toEqual({ channel: "rear", confident: false });
        expect(matchFilenameChannel(vf("CH3-20260618-130336.TS")).value).toEqual({
            channel: "interior",
            confident: false,
        });
    });

    it("SStar CHn negative: a plain digit-prefixed .ts is not claimed (disjoint from novatek-ts/juscar)", () => {
        expect(matchFilenameChannel(vf("20260618130336_000001.ts")).matchedId).toBeNull();
        expect(matchFilenameChannel(vf("20260618_130336F.ts")).matchedId).toBe("juscar-channel");
    });

    it("Vantrue B -> interior but NOT confident (B=cabin, index letter)", () => {
        const r = matchFilenameChannel(vf("20250607_180617_0001_N_B.mp4"));
        expect(r.matchedId).toBe("novatek-vantrue-channel");
        expect(r.value).toEqual({ channel: "interior", confident: false });
    });

    it("Tesla path -> confident (camera spelled out)", () => {
        const r = matchFilenameChannel(
            vf("2025-06-07_18-06-17-back.mp4", "TeslaCam/RecentClips/2025-06-07_18-06-17-back.mp4"),
        );
        expect(r.matchedId).toBe("tesla-channel");
        expect(r.value).toEqual({ channel: "rear", confident: true });
    });
});

describe("matchFilenameMode", () => {
    it("blackvue N letter -> normal", () => {
        const r = matchFilenameMode(vf("20211011_141314_NF.mp4"));
        expect(r.matchedId).toBe("blackvue-mode");
        expect(r.value).toBe("normal");
    });

    it("blackvue P letter -> parking", () => {
        expect(matchFilenameMode(vf("20211011_141314_PF.mp4")).value).toBe("parking");
    });

    it("70mai mode from folder", () => {
        const r = matchFilenameMode(vf("NO20240429-182640F.MP4", "Movie/Lapse/Front/NO20240429-182640F.MP4"));
        expect(r.matchedId).toBe("70mai-mode");
        expect(r.value).toBe("parking"); // Lapse folder = time-lapse parking
    });
});

describe("wolfbox techniques", () => {
    const NAME = "2026_03_15_173951_02_I.MP4";

    it("wolfbox-time parses YYYY_MM_DD_HHMMSS (beats generic-datetime)", () => {
        const r = matchFilenameTime(vf(NAME));
        expect(r.matchedId).toBe("wolfbox-time");
        expect(r.value?.getUTCFullYear()).toBe(2026);
        expect(r.value?.getUTCMonth()).toBe(2); // March
        expect(r.value?.getUTCHours()).toBe(17);
        expect(r.value?.getUTCSeconds()).toBe(51);
    });

    it("wolfbox-channel from the trailing letter, confident", () => {
        expect(matchFilenameChannel(vf(NAME)).value).toEqual({ channel: "interior", confident: true });
        expect(matchFilenameChannel(vf("2026_03_15_173951_00_F.MP4")).value).toEqual({
            channel: "front",
            confident: true,
        });
    });

    it("wolfbox-channel from the SD folder when the name does not match", () => {
        const r = matchFilenameChannel(vf("clip001.mp4", "extra_norm/clip001.mp4"));
        expect(r.matchedId).toBe("wolfbox-channel");
        expect(r.value).toEqual({ channel: "interior", confident: true });
    });

    it("wolfbox-mode from the EE code, folder as fallback", () => {
        expect(matchFilenameMode(vf(NAME)).value).toBe("event"); // EE=02
        expect(matchFilenameMode(vf("2026_03_15_173951_00_F.MP4")).value).toBe("normal");
        // Unknown EE code falls through to the folder signal.
        const r = matchFilenameMode(vf("2026_03_15_173951_05_F.MP4", "front_emer/2026_03_15_173951_05_F.MP4"));
        expect(r.matchedId).toBe("wolfbox-mode");
        expect(r.value).toBe("event");
    });
});

// Viofo E (impact event) / T (telephoto) letters - implemented from foreign
// source (viofosync scanner.py:48-66, naming.py:99-107), no real E/T sample
// in the corpus; synthetic names follow the documented shape.
describe("viofo E/T letters", () => {
    it("EF: time via novatek-viofo-time (off the generic-datetime fallback)", () => {
        const r = matchFilenameTime(vf("2023_0412_111213_0042EF.MP4"));
        expect(r.matchedId).toBe("novatek-viofo-time");
        expect(r.value?.toISOString()).toBe("2023-04-12T11:12:13.000Z");
    });

    it("EF: channel front confident, mode event, sequence 42", () => {
        const ch = matchFilenameChannel(vf("2023_0412_111213_0042EF.MP4"));
        expect(ch.matchedId).toBe("novatek-viofo-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        const mode = matchFilenameMode(vf("2023_0412_111213_0042EF.MP4"));
        expect(mode.matchedId).toBe("novatek-mode");
        expect(mode.value).toBe("event");
        const seq = matchFilenameSequence(vf("2023_0412_111213_0042EF.MP4"));
        expect(seq.matchedId).toBe("novatek-sequence");
        expect(seq.value).toBe(42);
    });

    it("PT: channel side NOT confident (telephoto -> positional slot), mode parking", () => {
        const ch = matchFilenameChannel(vf("2023_0412_111213_0042PT.MP4"));
        expect(ch.matchedId).toBe("novatek-viofo-channel");
        expect(ch.value).toEqual({ channel: "side", confident: false });
        expect(matchFilenameMode(vf("2023_0412_111213_0042PT.MP4")).value).toBe("parking");
    });

    it("plain T: side guess, mode normal (empty optional mode group)", () => {
        expect(matchFilenameChannel(vf("2023_0412_111213_0042T.MP4")).value).toEqual({
            channel: "side",
            confident: false,
        });
        const mode = matchFilenameMode(vf("2023_0412_111213_0042T.MP4"));
        expect(mode.matchedId).toBe("novatek-mode");
        expect(mode.value).toBe("normal");
    });

    it("existing P/F behavior unchanged", () => {
        expect(matchFilenameChannel(vf("2023_0821_180010_062F.MP4")).value).toEqual({
            channel: "front",
            confident: true,
        });
        expect(matchFilenameMode(vf("2023_0821_180010_062PF.MP4")).value).toBe("parking");
    });

    it("negative: unknown X mode letter stays unclaimed by novatek techniques", () => {
        expect(matchFilenameChannel(vf("2023_0412_111213_0042XF.MP4")).matchedId).toBeNull();
        expect(matchFilenameMode(vf("2023_0412_111213_0042XF.MP4")).matchedId).toBeNull();
        expect(matchFilenameSequence(vf("2023_0412_111213_0042XF.MP4")).matchedId).toBeNull();
        // Time still recoverable via the generic fallback - only the
        // novatek-specific claim must not fire.
        expect(matchFilenameTime(vf("2023_0412_111213_0042XF.MP4")).matchedId).toBe("generic-datetime");
    });

    it("negative: Vantrue still resolves via its own technique", () => {
        const ch = matchFilenameChannel(vf("20230412_111213_0042_N_A.mp4"));
        expect(ch.matchedId).toBe("novatek-vantrue-channel");
        expect(matchFilenameMode(vf("20230412_111213_0042_N_A.mp4")).value).toBe("normal");
    });
});

// Viofo/Novatek RO locked-clip folder: firmware moves locked clips into
// DCIM/Movie/RO/ with unchanged filenames (viofosync scanner.py:57-63,
// a119_join.py:86-96).
describe("viofo RO locked folder", () => {
    it("Viofo name under Movie/RO/ -> event via novatek-mode", () => {
        const r = matchFilenameMode(vf("2023_0412_111213_0042F.MP4", "DCIM/Movie/RO/2023_0412_111213_0042F.MP4"));
        expect(r.matchedId).toBe("novatek-mode");
        expect(r.value).toBe("event");
    });

    it("same name under Movie/ -> normal via novatek-mode (not shadowed by fitcamx-mode)", () => {
        // matchedId is load-bearing: before the novatek-above-fitcamx reorder
        // the path-only fitcamx Movie/ claim returned "normal" first and the
        // RO/parking letters never got a chance.
        const r = matchFilenameMode(vf("2023_0412_111213_0042F.MP4", "DCIM/Movie/2023_0412_111213_0042F.MP4"));
        expect(r.matchedId).toBe("novatek-mode");
        expect(r.value).toBe("normal");
    });

    it("regression: parking letter under Movie/ -> parking (fitcamx used to shadow it)", () => {
        const r = matchFilenameMode(vf("2023_0412_111213_0042PF.MP4", "DCIM/Movie/2023_0412_111213_0042PF.MP4"));
        expect(r.matchedId).toBe("novatek-mode");
        expect(r.value).toBe("parking");
    });

    it("single-channel A119 under RO -> event (real name from a119_join.py:22)", () => {
        const r = matchFilenameMode(vf("2016_1224_094105_116.MP4", "DCIM/Movie/RO/2016_1224_094105_116.MP4"));
        expect(r.matchedId).toBe("novatek-mode");
        expect(r.value).toBe("event");
    });

    it("negative: non-Novatek name under ro/ gets no mode claim", () => {
        const r = matchFilenameMode(vf("IMG_1234.mp4", "ro/IMG_1234.mp4"));
        expect(r.value).toBeNull();
        expect(r.matchedId).toBeNull();
    });

    it("negative: Vantrue under Movie/RO/ keeps mode from its own letter", () => {
        const r = matchFilenameMode(vf("20230412_111213_0042_N_A.mp4", "DCIM/Movie/RO/20230412_111213_0042_N_A.mp4"));
        expect(r.matchedId).toBe("novatek-mode");
        expect(r.value).toBe("normal");
    });
});

// Nextbase yyMMdd_HHmmss_NNN_<channel><quality>.MP4 - implemented from
// foreign source (nb-dashcam-tools clipmergewidget.cpp:194-218); the FH shape
// is validated against a real 322GW-family clip, the other letters remain
// foreign-source-only. Fixture date matches the verbatim 512GW freeGPS
// hexdump in ExifTool QuickTimeStream.pl (~1717-1741): ASCII
// "20180919100959" -> 2018-09-19 10:09:59.
describe("nextbase techniques", () => {
    it("nextbase-time: unconditional 20yy pivot", () => {
        const r = matchFilenameTime(vf("180919_100959_001_FH.MP4"));
        expect(r.matchedId).toBe("nextbase-time");
        expect(r.value?.toISOString()).toBe("2018-09-19T10:09:59.000Z");
    });

    it("regression: name where generic-datetime parses a VALID WRONG date", () => {
        // generic-datetime aligns 201001_051213 as 2010-01-05T12:13:00 -
        // a plausible-looking wrong date. nextbase-time must win with the
        // correct 2020-10-01 05:12:13.
        const r = matchFilenameTime(vf("201001_051213_001_FH.MP4"));
        expect(r.matchedId).toBe("nextbase-time");
        expect(r.value?.toISOString()).toBe("2020-10-01T05:12:13.000Z");
    });

    it("channel: F sure front, R sure rear, B guess interior", () => {
        const f = matchFilenameChannel(vf("180919_100959_001_FH.MP4"));
        expect(f.matchedId).toBe("nextbase-channel");
        expect(f.value).toEqual({ channel: "front", confident: true });
        expect(matchFilenameChannel(vf("180919_100959_001_RL.MP4")).value).toEqual({
            channel: "rear",
            confident: true,
        });
        expect(matchFilenameChannel(vf("180919_100959_001_BH.MP4")).value).toEqual({
            channel: "interior",
            confident: false,
        });
    });

    it("sequence: 3-digit counter", () => {
        const r = matchFilenameSequence(vf("180919_100959_001_FH.MP4"));
        expect(r.matchedId).toBe("nextbase-sequence");
        expect(r.value).toBe(1);
    });

    it("no mode technique: the name carries no mode field", () => {
        const r = matchFilenameMode(vf("180919_100959_001_FH.MP4"));
        expect(r.value).toBeNull();
        expect(r.matchedId).toBeNull();
    });

    it("negative: near-miss names are not claimed by nextbase", () => {
        // Invalid quality letter.
        expect(matchFilenameChannel(vf("180919_100959_001_FX.MP4")).matchedId).toBeNull();
        // 7-digit date.
        expect(matchFilenameChannel(vf("1809245_100959_001_FH.MP4")).matchedId).toBeNull();
        // BlackVue (8-digit date) keeps resolving via its own techniques.
        expect(matchFilenameTime(vf("20190919_100959_NF.mp4")).matchedId).toBe("blackvue-time");
        expect(matchFilenameChannel(vf("20190919_100959_NF.mp4")).matchedId).toBe("blackvue-channel");
        // E-Ace (8-digit date, no counter) untouched.
        expect(matchFilenameChannel(vf("20240429_182640F.mp4")).matchedId).toBe("e-ace-channel");
        // Vantrue untouched.
        expect(matchFilenameChannel(vf("20230412_111213_0042_N_A.mp4")).matchedId).toBe("novatek-vantrue-channel");
    });
});

describe("matchFilenameSequence", () => {
    it("70mai counter extracted", () => {
        const r = matchFilenameSequence(vf("NO20240429-182640-000897F.mp4"));
        expect(r.matchedId).toBe("70mai-sequence");
        expect(r.value).toBe(897);
    });

    it("tesla camera-id sequence", () => {
        const r = matchFilenameSequence(vf("front.mp4", "TeslaCam/SentryClips/2026-04-29_18-30-15/front.mp4"));
        expect(r.matchedId).toBe("tesla-sequence");
        expect(r.value).toBe(0); // front = 0 in Tesla camera-id mapping
    });

    it("no sequence in filename - null", () => {
        const r = matchFilenameSequence(vf("clip.mp4"));
        expect(r.value).toBeNull();
        expect(r.matchedId).toBeNull();
    });
});

describe("ford built-in dashcam techniques", () => {
    // Real sample name from a FordFootage drop.
    it("ford-time parses YYYY-MM-DD_HH_MM_SS (beats generic-datetime)", () => {
        const r = matchFilenameTime(vf("2026-06-14_16_16_18_f.ts"));
        expect(r.matchedId).toBe("ford-time");
        expect(r.value?.getUTCFullYear()).toBe(2026);
        expect(r.value?.getUTCMonth()).toBe(5); // June
        expect(r.value?.getUTCDate()).toBe(14);
        expect(r.value?.getUTCHours()).toBe(16);
        expect(r.value?.getUTCMinutes()).toBe(16);
        expect(r.value?.getUTCSeconds()).toBe(18);
    });

    it("ford-mode: name match asserts normal (like e-ace/carcam/ibox), not null", () => {
        const r = matchFilenameMode(vf("2026-06-14_16_16_18_f.ts"));
        expect(r.matchedId).toBe("ford-mode");
        expect(r.value).toBe("normal");
    });

    it("ford-channel: f -> front, confident (confirmed on a real sample)", () => {
        const r = matchFilenameChannel(vf("2026-06-14_16_16_18_f.ts"));
        expect(r.matchedId).toBe("ford-channel");
        expect(r.value).toEqual({ channel: "front", confident: true });
    });

    it("ford-channel: mnemonic letters r/b -> rear, i -> interior, confident", () => {
        expect(classifyFilenameChannel(vf("2026-06-14_16_16_18_r.ts"))).toEqual({ channel: "rear", confident: true });
        expect(classifyFilenameChannel(vf("2026-06-14_16_16_18_b.ts"))).toEqual({ channel: "rear", confident: true });
        expect(classifyFilenameChannel(vf("2026-06-14_16_16_18_i.ts"))).toEqual({
            channel: "interior",
            confident: true,
        });
    });

    it("ford-channel: an unconfirmed letter goes to the FREE side slot, not rear (guessed)", () => {
        // Any non-`f` letter must NOT default to "front" (would collide with the
        // real front file) NOR to "rear" (would collide with a real `_r`/`_b` and
        // spawn a dup frame). It takes the free "side" slot so it still pairs into
        // one frame. Guessed mount -> confident:false (positional UI label).
        expect(classifyFilenameChannel(vf("2026-06-14_16_16_18_x.ts"))).toEqual({ channel: "side", confident: false });
    });

    it("negative: RX_FORD rejects other .ts family name shapes (pins the regex boundary)", () => {
        // Direct on the regex, not just via walk order: a contiguous-digit date is
        // NOT Ford, so the family can never poach Juscar/FitCamX names even if the
        // walk order or a path signal changes later.
        expect(RX_FORD.test("20260614_161618F.ts")).toBe(false); // Juscar (8-digit date)
        expect(RX_FORD.test("20260614161618_000123A.ts")).toBe(false); // FitCamX (14-digit ts)
        expect(RX_FORD.test("2026-06-14_16_16_18.ts")).toBe(false); // no channel letter
        expect(RX_FORD.test("2026-06-14_16_16_18_ff.ts")).toBe(false); // two-letter token
        expect(RX_FORD.test("2026-06-14_16_16_18_f.mp4")).toBe(false); // wrong extension
        // And the families still resolve via their own techniques.
        expect(matchFilenameTime(vf("20260614_161618F.ts")).matchedId).toBe("juscar-time");
        expect(matchFilenameChannel(vf("20260614_161618F.ts")).matchedId).toBe("juscar-channel");
        expect(matchFilenameChannel(vf("20260614161618_000123A.ts", "Movie/20260614161618_000123A.ts")).matchedId).toBe(
            "fitcamx-channel",
        );
    });
});

describe("mio/navman mivue techniques", () => {
    // Real sample name from the Navman MiVue 150 Safety drop. FILE<YYMMDD>-<HHMMSS>,
    // no channel letter, no sequence - what separates it from iBox and Navitel.
    it("mivue-time parses FILE<YYMMDD>-<HHMMSS> (YYMMDD, beats generic-datetime)", () => {
        const r = matchFilenameTime(vf("FILE260625-144859.MP4"));
        expect(r.matchedId).toBe("mivue-time");
        expect(r.value?.getUTCFullYear()).toBe(2026); // "26" is the year, not the day
        expect(r.value?.getUTCMonth()).toBe(5); // June
        expect(r.value?.getUTCDate()).toBe(25);
        expect(r.value?.getUTCHours()).toBe(14);
        expect(r.value?.getUTCMinutes()).toBe(48);
        expect(r.value?.getUTCSeconds()).toBe(59);
    });

    it("mivue-mode reads the Normal/Event/Parking folder, defaults to normal when flat", () => {
        expect(matchFilenameMode(vf("FILE260625-144859.MP4", "Normal/FILE260625-144859.MP4")).matchedId).toBe(
            "mivue-mode",
        );
        expect(classifyFilenameMode(vf("FILE260625-144859.MP4", "Normal/FILE260625-144859.MP4"))).toBe("normal");
        expect(classifyFilenameMode(vf("FILE260625-144859.MP4", "Event/FILE260625-144859.MP4"))).toBe("event");
        expect(classifyFilenameMode(vf("FILE260625-144859.MP4", "Parking/FILE260625-144859.MP4"))).toBe("parking");
        // Flat drop (user copied the videos out of their folders) -> normal.
        expect(classifyFilenameMode(vf("FILE260625-144859.MP4"))).toBe("normal");
    });

    it("negative: RX_MIVUE is disjoint from iBox and Navitel FILE-patterns", () => {
        expect(RX_MIVUE.test("FILE260625-144859.MP4")).toBe(true);
        expect(RX_MIVUE.test("FILE251231-235959F.mp4")).toBe(false); // iBox: trailing channel letter
        expect(RX_MIVUE.test("FILE251231-235959-000001.mov")).toBe(false); // Navitel: -sequence
        // ...and those names still resolve through their own techniques, not mivue.
        expect(matchFilenameTime(vf("FILE251231-235959F.mp4")).matchedId).toBe("ibox-time");
        expect(matchFilenameTime(vf("FILE251231-235959-000001.mov")).matchedId).toBe("navitel-time");
    });
});

// 70mai A810 lite: 2-channel model whose rear file uses an "R" suffix (the
// older multi-channel S500/A810/T800 use "B"), and whose event clips carry an
// "EV" prefix instead of "NO". Both variants must resolve through the shared
// 70mai techniques so front/rear/event converge to pairable fingerprints.
describe("70mai A810 lite rear (R) + event (EV) variants", () => {
    it("normal rear NO...R: 70mai-time + rear channel (confident) + sequence", () => {
        const name = "NO20260101-120000-000042R.MP4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("70mai-time");
        expect(t.value?.getUTCFullYear()).toBe(2026);
        expect(t.value?.getUTCMonth()).toBe(0); // January
        expect(t.value?.getUTCDate()).toBe(1);
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("70mai-channel");
        expect(ch.value).toEqual({ channel: "rear", confident: true });
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("70mai-sequence");
        expect(seq.value).toBe(42);
    });

    it("event front EV...F: 70mai time/channel/sequence + mode=event from prefix (flat, no folder)", () => {
        const name = "EV20260101-120000-000042F.MP4";
        expect(matchFilenameTime(vf(name)).matchedId).toBe("70mai-time");
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("70mai-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        expect(matchFilenameSequence(vf(name)).value).toBe(42);
        // relativePath == name -> no folder, so the mode comes from the EV prefix.
        const mode = matchFilenameMode(vf(name));
        expect(mode.matchedId).toBe("70mai-mode");
        expect(mode.value).toBe("event");
    });

    it("event rear EV...R: rear channel + mode=event from prefix (flat, no folder)", () => {
        const name = "EV20260101-120000-000042R.MP4";
        expect(matchFilenameChannel(vf(name)).value).toEqual({ channel: "rear", confident: true });
        expect(classifyFilenameMode(vf(name))).toBe("event");
    });

    it("normal prefix NO -> mode normal on a flat drop", () => {
        expect(classifyFilenameMode(vf("NO20260101-120000-000042F.MP4"))).toBe("normal");
    });

    it("path folder wins over the prefix and keeps parking/manual granularity", () => {
        // NO prefix but a Lapse folder -> parking: the folder is the richer signal
        // (four modes vs the prefix's two), so it takes precedence.
        const r = matchFilenameMode(
            vf("NO20260101-120000-000042F.MP4", "Movie/Lapse/Front/NO20260101-120000-000042F.MP4"),
        );
        expect(r.matchedId).toBe("70mai-mode");
        expect(r.value).toBe("parking");
    });

    it("rear resolves via the R letter even when the folder is /Rear/ (path regex omits Rear by design)", () => {
        // RX_70MAI_PATH_CHANNEL is deliberately NOT widened to Rear/ - the A810
        // name already carries the letter, and widening it would let 70mai claim
        // other vendors' /Rear/ files before their own techniques run.
        const r = matchFilenameChannel(
            vf("NO20260101-120000-000042R.MP4", "Movie/Normal/Rear/NO20260101-120000-000042R.MP4"),
        );
        expect(r.matchedId).toBe("70mai-channel");
        expect(r.value).toEqual({ channel: "rear", confident: true });
    });

    it("negative: a DDPai-shaped 14-digit leading token does not match RX_70MAI", () => {
        expect(RX_70MAI.test("20260101120000_0042.mp4")).toBe(false);
        // ...and it still resolves through DDPai, never 70mai.
        expect(matchFilenameChannel(vf("20260101120000_0042.mp4")).matchedId).toBe("ddpai-channel");
    });

    it("negative: the NO/EV prefix regex does not claim a non-70mai name", () => {
        // "NOTES.mp4" starts with NO but is not a 70mai name - the RX_70MAI gate
        // in 70mai-mode keeps the prefix branch from claiming it.
        expect(matchFilenameMode(vf("NOTES.mp4")).matchedId).not.toBe("70mai-mode");
    });
});

// 70mai A510 parking prefixes (LA = parking timelapse, PA = parking event)
// and the app-export shape with the channel letter BEFORE the trailing
// 14-digit wall-clock stamp. Both ride the shared RX_70MAI, so time/channel/
// sequence/camera-key and the embedded-GPS hint all follow from the regex.
describe("70mai A510 LA/PA prefixes + channel-before-stamp", () => {
    it("LA front: 70mai time/channel/sequence, mode parking from the prefix", () => {
        const name = "LA20260101-120000-000495F.MP4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("70mai-time");
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        expect(matchFilenameChannel(vf(name)).value).toEqual({ channel: "front", confident: true });
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("70mai-sequence");
        expect(seq.value).toBe(495);
        const mode = matchFilenameMode(vf(name));
        expect(mode.matchedId).toBe("70mai-mode");
        expect(mode.value).toBe("parking");
    });

    it("LA rear uses the B letter (A510 is a B-rear model)", () => {
        expect(classifyFilenameChannel(vf("LA20260101-120000-000495B.MP4"))).toEqual({
            channel: "rear",
            confident: true,
        });
    });

    it("PA prefix -> mode event (parking g-sensor capture mirrors EV)", () => {
        const mode = matchFilenameMode(vf("PA20260101-120000-001496F.MP4"));
        expect(mode.matchedId).toBe("70mai-mode");
        expect(mode.value).toBe("event");
    });

    it("channel letter BEFORE the trailing stamp: time/channel/sequence still resolve", () => {
        const name = "NO20260101-120000-000195R-20260101120642.mp4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("70mai-time");
        // The leading 8+6 digits are the clip start; the trailing stamp is a
        // second wall-clock value the app appends and must be ignored.
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("70mai-channel");
        expect(ch.value).toEqual({ channel: "rear", confident: true });
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("70mai-sequence");
        expect(seq.value).toBe(195);
        expect(classifyFilenameMode(vf(name))).toBe("normal");
    });

    it("channel letter AFTER the trailing stamp keeps working (older layout)", () => {
        expect(classifyFilenameChannel(vf("NO20260101-120000-000897-20260101120642F.mp4"))).toEqual({
            channel: "front",
            confident: true,
        });
    });

    it("M500 stamp with no channel letter: no channel claim, counter still rejected as sequence", () => {
        expect(matchFilenameChannel(vf("NO20260101-120000-000897-20260101120642.mp4")).matchedId).toBeNull();
        // No counter at all: the greedy counter group swallows the stamp and
        // the length guard must reject it.
        expect(matchFilenameSequence(vf("NO20260101-120000-20260101120642F.mp4")).value).toBeNull();
    });

    it("camera-key: LA/PA fold to NO, and the pre-stamp letter strips (front/rear converge)", () => {
        // Prefix folding: a parking clip is the same camera as its normal twin.
        expect(cameraFingerprint(vf("LA20260101-120000-000495F.MP4"))).toBe(
            cameraFingerprint(vf("NO20260101-120100-000496F.MP4")),
        );
        expect(cameraFingerprint(vf("PA20260101-120200-001496F.MP4"))).toBe(
            cameraFingerprint(vf("NO20260101-120100-000496F.MP4")),
        );
        // Pre-stamp letter: R and F of one app export converge (the terminal
        // `<letter>.` search cannot see this position - a dedicated strip does).
        expect(cameraFingerprint(vf("NO20260101-120000-000195R-20260101120642.mp4"))).toBe(
            cameraFingerprint(vf("NO20260101-120100-000196F-20260101120442.mp4")),
        );
    });

    it("negative: LA/PA lookalike words are not claimed by 70mai-mode", () => {
        expect(matchFilenameMode(vf("LAPSE-VIDEO.mp4")).matchedId).toBeNull();
        expect(matchFilenameMode(vf("PANORAMA.mp4")).matchedId).toBeNull();
    });
});

// Viofo/Novatek multi-channel names with NO sequence counter (T130 parking
// clips, some OEM firmwares): `YYYY_MMDD_HHMMSS_<P|E?><F|R|T|I>.mp4`.
describe("viofo optional sequence", () => {
    it("seq-less F: novatek time/channel/mode, sequence null (not NaN/0)", () => {
        const name = "2026_0708_180332_F.MP4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("novatek-viofo-time");
        expect(t.value?.toISOString()).toBe("2026-07-08T18:03:32.000Z");
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("novatek-viofo-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        expect(classifyFilenameMode(vf(name))).toBe("normal");
        const seq = matchFilenameSequence(vf(name));
        expect(seq.value).toBeNull();
        expect(seq.matchedId).toBeNull();
    });

    it("seq-less parking rear PR: mode parking, channel rear", () => {
        const name = "2022_0224_132829_PR.MP4";
        expect(matchFilenameTime(vf(name)).matchedId).toBe("novatek-viofo-time");
        expect(classifyFilenameChannel(vf(name))).toEqual({ channel: "rear", confident: true });
        const mode = matchFilenameMode(vf(name));
        expect(mode.matchedId).toBe("novatek-mode");
        expect(mode.value).toBe("parking");
    });

    it("camera-key: seq-less PF and PR converge (T130 front+rear pair)", () => {
        expect(cameraFingerprint(vf("2022_0224_132830_PF.MP4"))).toBe(cameraFingerprint(vf("2022_0224_132829_PR.MP4")));
    });

    it("negative: RX_NOVATEK_SINGLE (no channel letter) is untouched by the optional group", () => {
        const seq = matchFilenameSequence(vf("2016_1224_094105_116.MP4"));
        expect(seq.matchedId).toBe("novatek-sequence");
        expect(seq.value).toBe(116);
        expect(matchFilenameChannel(vf("2016_1224_094105_116.MP4")).matchedId).toBe("novatek-single-channel");
    });
});

// DDPai-normal counter widened to 6-7 digits: the `<14-digit>_<counter>` shape
// is shared with Novatek-family OEMs (Fujida Karma, Roadgid Tube) that embed
// freeGPS - name classification still routes through the ddpai techniques.
describe("ddpai 6/7-digit counters", () => {
    it("6-digit counter: ddpai time/channel/mode/sequence", () => {
        const name = "20260101120000_000551.MP4";
        expect(matchFilenameTime(vf(name)).matchedId).toBe("ddpai-time");
        expect(matchFilenameChannel(vf(name)).matchedId).toBe("ddpai-channel");
        expect(classifyFilenameMode(vf(name))).toBe("normal");
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("ddpai-sequence");
        expect(seq.value).toBe(551);
    });

    it("7-digit counter: sequence 13", () => {
        expect(classifyFilenameSequence(vf("20260101120000_0000013.MP4"))).toBe(13);
    });

    it("negative: an 8-digit counter is NOT ddpai", () => {
        expect(RX_DDPAI_NORMAL.test("20260101120000_00000001.mp4")).toBe(false);
        expect(matchFilenameChannel(vf("20260101120000_00000001.mp4")).matchedId).toBeNull();
        expect(matchFilenameSequence(vf("20260101120000_00000001.mp4")).matchedId).toBeNull();
    });
});

// Neoline Spectrum: INF<date>-<time>-<unpadded seq>-<F|R>.mp4. R = rear is an
// assumption (front-only corpus). The name carries no mode.
describe("neoline techniques", () => {
    it("time/channel/sequence resolve, mode stays null", () => {
        const name = "INF20260101-120000-14-F.mp4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("neoline-time");
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("neoline-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("neoline-sequence");
        expect(seq.value).toBe(14);
        expect(matchFilenameMode(vf(name)).matchedId).toBeNull();
    });

    it("unpadded single-digit sequence", () => {
        expect(classifyFilenameSequence(vf("INF20260101-120000-1-F.mp4"))).toBe(1);
    });

    it("R channel (assumed rear) and camera-key convergence with front", () => {
        expect(classifyFilenameChannel(vf("INF20260101-120000-14-R.mp4"))).toEqual({
            channel: "rear",
            confident: true,
        });
        expect(cameraFingerprint(vf("INF20260101-120000-14-R.mp4"))).toBe(
            cameraFingerprint(vf("INF20260101-120000-14-F.mp4")),
        );
    });

    it("negative: near-miss names are not claimed", () => {
        expect(RX_NEOLINE.test("INFO20260101-120000-14-F.mp4")).toBe(false); // INF is a strict prefix
        expect(RX_NEOLINE.test("INF20260101-120000-14.mp4")).toBe(false); // channel letter mandatory
        expect(RX_NEOLINE.test("INF20260101-120000-14-A.mp4")).toBe(false); // only F/R
    });
});

// Vueroid S1 4K Infinite: <date>_<time>_INF_<F|R>_<N|E|P>.mp4. N is the
// validated shape; E/P modes and the R channel are mnemonic assumptions.
describe("vueroid techniques", () => {
    it("F_N: time/channel/mode resolve, no sequence in the name", () => {
        const name = "20260101_120000_INF_F_N.mp4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("vueroid-time");
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        const ch = matchFilenameChannel(vf(name));
        expect(ch.matchedId).toBe("vueroid-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        const mode = matchFilenameMode(vf(name));
        expect(mode.matchedId).toBe("vueroid-mode");
        expect(mode.value).toBe("normal");
        expect(matchFilenameSequence(vf(name)).matchedId).toBeNull();
    });

    it("E -> event, P -> parking (assumed letters)", () => {
        expect(classifyFilenameMode(vf("20260101_120000_INF_F_E.mp4"))).toBe("event");
        expect(classifyFilenameMode(vf("20260101_120000_INF_R_P.mp4"))).toBe("parking");
    });

    it("camera-key: channel AND mode letters fold - all clips of one camera converge", () => {
        expect(cameraFingerprint(vf("20260101_120000_INF_R_N.mp4"))).toBe(
            cameraFingerprint(vf("20260101_120000_INF_F_N.mp4")),
        );
        // Mode is a per-clip attribute, not camera identity (the mai70
        // EV/LA/PA rationale): an event clip written mid-loop must chain into
        // the same trip as its N siblings.
        expect(cameraFingerprint(vf("20260101_120000_INF_F_E.mp4"))).toBe(
            cameraFingerprint(vf("20260101_120000_INF_F_N.mp4")),
        );
    });

    it("negative: underscore families with no INF literal stay on their own techniques", () => {
        expect(RX_VUEROID.test("20260101_120000_NF.mp4")).toBe(false);
        expect(matchFilenameChannel(vf("20260101_120000_NF.mp4")).matchedId).toBe("blackvue-channel");
        expect(matchFilenameChannel(vf("20230412_111213_0042_N_A.mp4")).matchedId).toBe("novatek-vantrue-channel");
        expect(matchFilenameChannel(vf("20260101_120000F.mp4")).matchedId).toBe("e-ace-channel");
    });
});

// Unbranded SigmaStar single-channel cam: REC<date>-<time>-<seq>.mp4 - the
// CarCam shape minus the mandatory -A..D channel letter.
describe("rec-single techniques", () => {
    it("time/sequence resolve; no channel or mode in the name", () => {
        const name = "REC20260101-120000-228.mp4";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("rec-single-time");
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("rec-single-sequence");
        expect(seq.value).toBe(228);
        expect(matchFilenameChannel(vf(name)).matchedId).toBeNull();
        expect(matchFilenameMode(vf(name)).matchedId).toBeNull();
    });

    it("camera-key is stable across timestamps", () => {
        expect(cameraFingerprint(vf("REC20260101-120000-228.mp4"))).toBe(
            cameraFingerprint(vf("REC20260101-120100-229.mp4")),
        );
    });

    it("negative: a REC name WITH a channel letter is still carcam, not rec-single", () => {
        expect(RX_REC_SINGLE.test("REC20260101-120000-228-A.mp4")).toBe(false);
        expect(matchFilenameTime(vf("REC20260101-120000-228-A.mp4")).matchedId).toBe("carcam-time");
        expect(matchFilenameChannel(vf("REC20260101-120000-228-A.mp4")).matchedId).toBe("carcam-channel");
    });

    it("negative: 6-digit sequence and Thinkware REC_ names are not claimed", () => {
        expect(RX_REC_SINGLE.test("REC20260101-120000-123456.mp4")).toBe(false);
        expect(matchFilenameTime(vf("REC_20210101_120000_F.mp4")).matchedId).not.toBe("rec-single-time");
        expect(matchFilenameChannel(vf("REC_20210101_120000_F.mp4")).matchedId).toBe("thinkware-channel");
    });
});

// Novatek MPEG-TS OEMs: <14-digit>_<6-digit>.ts - the ddpai-normal name
// scheme in a TS container. Disjoint from FitCamX (trailing letter there).
describe("novatek-ts techniques", () => {
    it("time/sequence resolve via the dedicated technique, not the generic fallback", () => {
        const name = "20260101120000_000188.TS";
        const t = matchFilenameTime(vf(name));
        expect(t.matchedId).toBe("novatek-ts-time");
        expect(t.value?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        const seq = matchFilenameSequence(vf(name));
        expect(seq.matchedId).toBe("novatek-ts-sequence");
        expect(seq.value).toBe(188);
        expect(matchFilenameChannel(vf(name)).matchedId).toBeNull();
        expect(matchFilenameMode(vf(name)).matchedId).toBeNull();
    });

    it("camera-key is stable across timestamps", () => {
        expect(cameraFingerprint(vf("20260101120000_000188.TS"))).toBe(
            cameraFingerprint(vf("20260101125000_000192.TS")),
        );
    });

    it("negative: FitCamX (trailing letter) and ddpai (.mp4) stay on their own techniques", () => {
        expect(matchFilenameChannel(vf("20260101120000_000188A.ts", "Movie/20260101120000_000188A.ts")).matchedId).toBe(
            "fitcamx-channel",
        );
        expect(matchFilenameTime(vf("20260101120000_000188A.ts")).matchedId).toBe("fitcamx-time");
        expect(matchFilenameTime(vf("20260101120000_000188.mp4")).matchedId).toBe("ddpai-time");
    });
});

// HP (f969x, SigmaStar CarDV): HPIM<8-digit>-<6-digit><letter>.TS under
// <Mode>/<channel letter>/ folders. Front-only corpus; other letters are
// mnemonic assumptions.
describe("hpim techniques", () => {
    const path = "0811/f969x/Normal/F/HPIM20260811-170040F.TS";

    it("F letter -> front confident; unknown letter -> side guess", () => {
        const ch = matchFilenameChannel(vf("HPIM20260811-170040F.TS", path));
        expect(ch.matchedId).toBe("hpim-channel");
        expect(ch.value).toEqual({ channel: "front", confident: true });
        expect(classifyFilenameChannel(vf("HPIM20260811-170040R.TS"))).toEqual({ channel: "rear", confident: true });
        expect(classifyFilenameChannel(vf("HPIM20260811-170040X.TS"))).toEqual({ channel: "side", confident: false });
    });

    it("mode from the folder above the channel letter; flat drop defaults to normal", () => {
        const mode = matchFilenameMode(vf("HPIM20260811-170040F.TS", path));
        expect(mode.matchedId).toBe("hpim-mode");
        expect(mode.value).toBe("normal");
        expect(classifyFilenameMode(vf("HPIM20260811-170040F.TS", "Event/F/HPIM20260811-170040F.TS"))).toBe("event");
        expect(classifyFilenameMode(vf("HPIM20260811-170040F.TS", "Parking/F/HPIM20260811-170040F.TS"))).toBe(
            "parking",
        );
        expect(classifyFilenameMode(vf("HPIM20260811-170040F.TS"))).toBe("normal");
    });

    it("time stays on the generic fallback; no sequence in the name", () => {
        const t = matchFilenameTime(vf("HPIM20260811-170040F.TS", path));
        expect(t.matchedId).toBe("generic-datetime");
        expect(t.value?.toISOString()).toBe("2026-08-11T17:00:40.000Z");
        expect(matchFilenameSequence(vf("HPIM20260811-170040F.TS")).matchedId).toBeNull();
    });

    it("camera-key: channels and mode folders converge, the card root above them stays", () => {
        const front = cameraFingerprint(vf("HPIM20260811-170040F.TS", path));
        expect(front, "rear in its own letter folder shares the key").toBe(
            cameraFingerprint(vf("HPIM20260811-170040R.TS", "0811/f969x/Normal/R/HPIM20260811-170040R.TS")),
        );
        expect(front, "an event clip of the same camera shares the key").toBe(
            cameraFingerprint(vf("HPIM20260811-171000F.TS", "0811/f969x/Event/F/HPIM20260811-171000F.TS")),
        );
        expect(front, "a different card root is a different camera").not.toBe(
            cameraFingerprint(vf("HPIM20260811-170040F.TS", "0812/other/Normal/F/HPIM20260811-170040F.TS")),
        );
    });

    it("negative: prefix-less and foreign .ts families are not claimed", () => {
        expect(RX_HPIM.test("20260811-170040F.TS")).toBe(false); // HPIM literal mandatory
        expect(RX_HPIM.test("HPIM20260811-170040.TS")).toBe(false); // letter mandatory
        expect(RX_HPIM.test("HPIM20260811-170040F.mp4")).toBe(false); // .ts only
        expect(matchFilenameChannel(vf("20260811_170040F.ts")).matchedId).toBe("juscar-channel");
        expect(matchFilenameChannel(vf("CH1-20260811-170040.ts")).matchedId).toBe("sstar-chn-channel");
    });
});

// Unknown-vendor 3-channel .mov camera: <14-digit>_<7-digit><F|R|I>.mov.
// Filename-only corpus (diagnostic report); the F/R/I mnemonics are
// content-unvalidated.
describe("mov-seq-fri techniques", () => {
    it("F/R/I letters map to mnemonic mounts, confident", () => {
        const front = matchFilenameChannel(vf("20260811083704_0000826F.mov"));
        expect(front.matchedId).toBe("mov-seq-fri-channel");
        expect(front.value).toEqual({ channel: "front", confident: true });
        expect(classifyFilenameChannel(vf("20260811083704_0000826R.mov"))).toEqual({
            channel: "rear",
            confident: true,
        });
        expect(classifyFilenameChannel(vf("20260811083706_0000826I.mov"))).toEqual({
            channel: "interior",
            confident: true,
        });
    });

    it("sequence resolves; time stays on the generic fallback; no mode", () => {
        const seq = matchFilenameSequence(vf("20260811083704_0000826F.mov"));
        expect(seq.matchedId).toBe("mov-seq-fri-sequence");
        expect(seq.value).toBe(826);
        const t = matchFilenameTime(vf("20260811083704_0000826F.mov"));
        expect(t.matchedId).toBe("generic-datetime");
        expect(t.value?.toISOString()).toBe("2026-08-11T08:37:04.000Z");
        expect(matchFilenameMode(vf("20260811083704_0000826F.mov")).matchedId).toBeNull();
    });

    it("camera-key: all three channels converge on one fingerprint despite the interior's later stamp", () => {
        const front = cameraFingerprint(vf("20260811083704_0000826F.mov", "dash/20260811083704_0000826F.mov"));
        expect(front, "rear shares the key").toBe(
            cameraFingerprint(vf("20260811083704_0000826R.mov", "dash/20260811083704_0000826R.mov")),
        );
        expect(front, "interior shares the key").toBe(
            cameraFingerprint(vf("20260811083706_0000826I.mov", "dash/20260811083706_0000826I.mov")),
        );
    });

    it("negative: extension/counter-width twins stay off the technique", () => {
        expect(RX_MOV_SEQ_FRI.test("20260811083704_0000826F.mp4")).toBe(false); // .mov only
        expect(RX_MOV_SEQ_FRI.test("20260811083704_000826F.mov")).toBe(false); // 6-digit counter
        expect(RX_MOV_SEQ_FRI.test("20260811083704_0000826.mov")).toBe(false); // letter mandatory
        expect(RX_MOV_SEQ_FRI.test("20260811083704_0000826A.mov")).toBe(false); // only F/R/I
        // The neighbouring stamp+counter families keep their own techniques.
        expect(matchFilenameTime(vf("20260811083704_082606F.ts")).matchedId).toBe("fitcamx-time");
        expect(matchFilenameTime(vf("20260811083704_0000826.mp4")).matchedId).toBe("ddpai-time");
    });
});

describe("classify shortcuts return value only", () => {
    it("classifyFilenameTime returns the Date", () => {
        const time = classifyFilenameTime(vf("NO20240429-182640F.MP4"));
        expect(time).toBeInstanceOf(Date);
    });

    it("classifyFilenameChannel returns the ChannelMatch", () => {
        expect(classifyFilenameChannel(vf("NO20240429-182640B.MP4"))).toEqual({ channel: "rear", confident: true });
    });

    it("classifyFilenameMode returns the RecordingMode", () => {
        expect(classifyFilenameMode(vf("20211011_141314_EF.mp4"))).toBe("event");
    });

    it("classifyFilenameSequence returns the number", () => {
        expect(classifyFilenameSequence(vf("REC20250607-180617-527-A.mp4"))).toBe(527);
    });
});

describe("classifyFilenameTimelapse", () => {
    it("flags 70mai A510 LA clips (flat drop) and the Lapse/ folder (foldered)", () => {
        expect(classifyFilenameTimelapse(vf("LA20240517-113611-000495F.MP4"))).toBe(true);
        expect(
            classifyFilenameTimelapse(
                vf("NO20240509-134909-000016F.MP4", "Movie/Lapse/Front/NO20240509-134909-000016F.MP4"),
            ),
        ).toBe(true);
    });

    it("does not flag other 70mai modes (NO/EV/PA)", () => {
        expect(classifyFilenameTimelapse(vf("NO20240509-134909-000016F.MP4"))).toBe(false);
        expect(classifyFilenameTimelapse(vf("EV20240509-134909-000016F.MP4"))).toBe(false);
        expect(classifyFilenameTimelapse(vf("PA20240522-105412-001496F.MP4"))).toBe(false);
    });

    it("flags DDPai time-lapse (S_/Q_ prefix)", () => {
        expect(classifyFilenameTimelapse(vf("S_20260101120000_0001_0100.mp4"))).toBe(true);
        expect(classifyFilenameTimelapse(vf("Q_20260101120000_0001_0100.mp4"))).toBe(true);
    });

    it("the two-letter LA prefix alone does not claim a foreign name", () => {
        // No 70mai shape (RX_70MAI gates the prefix branch) -> not time-lapse.
        expect(classifyFilenameTimelapse(vf("LATE-night-clip.mp4"))).toBe(false);
        expect(classifyFilenameTimelapse(vf("video.mp4"))).toBe(false);
    });
});

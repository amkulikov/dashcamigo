import { describe, expect, it } from "vitest";
import { cameraFingerprint } from "../camera-fingerprint.js";
import { classifyGpsSource, shouldTryEmbeddedGps } from "../gps-source-hints.js";
import type { VendorFile } from "../types.js";
import {
    classifyFilenameChannel,
    classifyFilenameMode,
    classifyFilenameRecordingKey,
    classifyFilenameSequence,
    classifyFilenameTime,
    classifyFilenameTimelapse,
    matchFilenameChannel,
} from "./index.js";

function vf(name: string, folder = "card"): VendorFile {
    return { file: new File([], name), relativePath: `${folder}/${name}` };
}

describe("timestamp filename variations", () => {
    it.each(["R.MP4", "_R.mp4", "-r.Mp4"])("normalizes the %s channel token and extension case", (suffix) => {
        const front = vf("20260101_120000.MP4");
        const rear = vf(`20260101_120001${suffix}`);
        expect(classifyFilenameChannel(rear)).toEqual({ channel: "rear", confident: true });
        expect(classifyFilenameTime(rear)?.toISOString()).toBe("2026-01-01T12:00:01.000Z");
        expect(classifyFilenameRecordingKey(rear)).toBe("20260101_120001");
        expect(cameraFingerprint(rear)).toBe(cameraFingerprint(front));
        expect(cameraFingerprint(rear)).not.toBe(cameraFingerprint(vf(rear.file.name, "other")));
    });

    it.each(["20260101_120000-.mp4", "20260101_120000--R.mp4", "20260101_120000_-R.mp4"])(
        "leaves malformed %s channel tokens unclaimed",
        (name) => {
            expect(classifyFilenameChannel(vf(name))).toBeNull();
            expect(classifyFilenameRecordingKey(vf(name))).toBeNull();
        },
    );

    it.each(["20260101_120000.mp4", "20260101120000_001.mp4"])(
        "uses spelled-out folders when %s has no channel suffix",
        (name) => {
            const files = ["Front", "Rear", "Inside"].map((folder) => vf(name, `card/${folder}`));
            expect(files.map((file) => classifyFilenameChannel(file))).toEqual([
                { channel: "front", confident: true },
                { channel: "rear", confident: true },
                { channel: "interior", confident: true },
            ]);
            expect(new Set(files.map(cameraFingerprint)).size).toBe(1);
            expect(cameraFingerprint(files[0]!)).not.toBe(cameraFingerprint(vf(name, "other/Front")));
        },
    );

    it.each(["Video", "Event"])("reads suffixless %s channel folders consistently", (mode) => {
        const files = ["Front", "Rear", "Inside"].map((folder) => vf("20260101_120000.mp4", `card/${mode}_${folder}`));
        expect(files.map((file) => classifyFilenameChannel(file)?.channel)).toEqual(["front", "rear", "interior"]);
        expect(new Set(files.map(cameraFingerprint)).size).toBe(1);
        expect(classifyFilenameMode(files[0]!)).toBe(mode === "Event" ? "event" : "normal");
        expect(cameraFingerprint(files[0]!)).not.toBe(
            cameraFingerprint(vf("20260101_120000.mp4", `card/${mode === "Video" ? "Event" : "Video"}_Front`)),
        );
    });

    it.each(["20260101_120000_R.mp4", "20260101120000_001_R.mp4", "20260101120000_001_A.mp4"])(
        "retains the explicit %s channel under a conflicting folder",
        (name) => {
            expect(classifyFilenameChannel(vf(name, "card/Front"))?.channel).toBe("rear");
        },
    );

    it.each(["20260101_120000.mp4", "20260101120000_001.mp4"])(
        "uses adjacent mode folders without claiming an archive's mode for %s",
        (name) => {
            for (const [folder, mode] of [
                ["Event", "event"],
                ["Parking", "parking"],
                ["Favorites", "manual"],
            ]) {
                expect(classifyFilenameMode(vf(name, `card/${folder}`))).toBe(mode);
                expect(classifyFilenameMode(vf(name, `card/${folder}/Rear`))).toBe(mode);
                expect(classifyFilenameTimelapse(vf(name, `card/${folder}`))).toBe(false);
            }
            expect(classifyFilenameMode(vf(name, "Event/archive"))).toBe("normal");
            expect(classifyFilenameMode(vf(name, "Event/card/Normal/Rear"))).toBe("normal");
        },
    );

    it("keeps explicit DDPai mode markers authoritative", () => {
        expect(classifyFilenameMode(vf("S_20260101120000_001_30.mp4", "card/Event"))).toBe("parking");
        expect(classifyFilenameMode(vf("G_20260101120000_001_L.mp4", "card/Parking"))).toBe("event");
    });

    it("normalizes DDPai extension case without stripping the enclosing card", () => {
        const front = vf("20260101120000_001.MP4", "F/Front");
        const rear = vf("20260101120000_001_A.mp4", "F/Rear");
        expect(cameraFingerprint(front)).toBe(cameraFingerprint(rear));
        expect(cameraFingerprint(front)).not.toBe(cameraFingerprint(vf(front.file.name, "Front")));
    });

    it.each([
        ["I", "interior", true],
        ["X", "side", false],
    ] as const)("retains the %s TS channel and its enclosing card", (suffix, channel, confident) => {
        const front = vf("20260101_120000_F.ts", "X/F");
        const sibling = vf(`20260101_120000_${suffix}.ts`, `X/${suffix}`);
        expect(classifyFilenameChannel(sibling)).toEqual({ channel, confident });
        expect(cameraFingerprint(sibling)).toBe(cameraFingerprint(front));
        expect(cameraFingerprint(sibling)).not.toBe(cameraFingerprint(vf(sibling.file.name, suffix)));
    });
});

describe("REC counter growth", () => {
    it.each(["99999", "100000", "000000001", "9007199254740991"])(
        "retains metadata and camera identity for counter %s",
        (counter) => {
            for (const [prefix, suffix, folder] of [
                ["REC", "-A", "card/normal/a"],
                ["REC", "", "card/Normal/F"],
                ["SOS", "", "card/Event/F"],
                ["PAR", "", "card/Parking/F"],
            ]) {
                const file = vf(`${prefix}20260101-120000-${counter}${suffix}.mp4`, folder);
                expect(classifyFilenameSequence(file)).toBe(Number(counter));
                expect(classifyFilenameTime(file)?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
                expect(classifyFilenameChannel(file)?.channel).toBe("front");
                expect(cameraFingerprint(file)).toBe(
                    cameraFingerprint(vf(`${prefix}20260101-120000-1${suffix}.mp4`, folder)),
                );
            }
        },
    );

    it.each(["9007199254740992", "9".repeat(400)])("leaves an unsafe counter unclaimed: %s", (counter) => {
        for (const suffix of ["", "-A"]) {
            const file = vf(`REC20260101-120000-${counter}${suffix}.mp4`);
            expect(classifyFilenameSequence(file)).toBeNull();
            expect(classifyFilenameTime(file)?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
        }
    });
});

describe("filename family boundaries", () => {
    it.each([
        "20260101_120000-R.mp4",
        "20260101_120000_I.ts",
        "REC20260101-120000-100000-A.mp4",
        "SOS20260101-120000-100000.mp4",
    ])("keeps embedded GPS probing enabled for %s", (name) => {
        const file = vf(name);
        expect(classifyGpsSource(file)).toBe("embedded");
        expect(shouldTryEmbeddedGps(file, false)).toBe(true);
        expect(shouldTryEmbeddedGps(file, true)).toBe(false);
    });

    it("preserves TS counter-width semantics and unknown MP4 shapes", () => {
        const fitcamx = vf("20260101120000_000001F.ts");
        const trailer = vf("20260101120000_0000001F.ts");
        const unknown = vf("20260101120000_0000001F.mp4");
        expect(classifyFilenameChannel(fitcamx)).toBeNull();
        expect(classifyGpsSource(fitcamx)).toBe("none");
        expect(shouldTryEmbeddedGps(fitcamx, false)).toBe(false);
        expect(classifyFilenameChannel(trailer)?.channel).toBe("front");
        expect(classifyGpsSource(trailer)).toBe("embedded");
        expect(classifyFilenameChannel(unknown)).toBeNull();
        expect(classifyGpsSource(unknown)).toBe("unknown");
        expect(shouldTryEmbeddedGps(unknown, false)).toBe(true);
    });

    it("preserves explicit BlackVue channels, modes and Nextbase quality streams", () => {
        const blackvue = vf("20260101_120000_NR.mp4", "card/Event/Front");
        expect(classifyFilenameChannel(blackvue)?.channel).toBe("rear");
        expect(classifyFilenameMode(blackvue)).toBe("normal");
        expect(cameraFingerprint(vf("260101_120000_001_FH.mp4"))).not.toBe(
            cameraFingerprint(vf("260101_120000_001_FL.mp4")),
        );
        expect(matchFilenameChannel(vf("20260101_120000R.ts")).matchedId).toBe("juscar-channel");
    });
});

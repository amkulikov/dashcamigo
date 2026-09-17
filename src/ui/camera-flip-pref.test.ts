import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeTripFromFrames } from "../trips.js";
import { buildProvisionalCandidate } from "./ingest-candidate.js";
import { _resetForTests, cameraFlipForChannel, saveCameraFlip } from "./camera-flip-pref.js";

const storage = new Map<string, string>();
const horizontal = { horizontal: true, vertical: false };
const vertical = { horizontal: false, vertical: true };
const unchanged = { horizontal: false, vertical: false };

function trip(fingerprint: string) {
    const file = new File(["video"], "clip.mp4");
    const candidate = buildProvisionalCandidate({
        file: { file, relativePath: file.name },
        fingerprint,
        startUtc: 1000,
        startSource: "mp4",
        cameraTzSec: null,
        durationSec: 10,
        records: [],
        appliedExtractors: [],
    });
    return finalizeTripFromFrames([
        { startUtc: 1000, durationSec: 10, wallDurationSec: 10, channels: { front: candidate, rear: candidate } },
    ]);
}

beforeEach(() => {
    storage.clear();
    _resetForTests();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("camera reflection preferences", () => {
    it("remembers each channel across trips and reloads without affecting another fingerprint", () => {
        saveCameraFlip("front", horizontal, trip("camera-a"));
        saveCameraFlip("rear", vertical, trip("camera-a"));
        _resetForTests();
        expect(cameraFlipForChannel("front", trip("camera-a"))).toEqual(horizontal);
        expect(cameraFlipForChannel("rear", trip("camera-a"))).toEqual(vertical);
        expect(cameraFlipForChannel("front", trip("camera-b"))).toEqual(unchanged);
    });

    it("removes a reset choice without resetting the other channel", () => {
        saveCameraFlip("front", horizontal, trip("camera-a"));
        saveCameraFlip("rear", vertical, trip("camera-a"));
        saveCameraFlip("front", unchanged, trip("camera-a"));
        _resetForTests();
        expect(cameraFlipForChannel("front", trip("camera-a"))).toEqual(unchanged);
        expect(cameraFlipForChannel("rear", trip("camera-a"))).toEqual(vertical);
    });

    it("ignores malformed storage and keeps working when writes are blocked", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => '[null,42,{"key":"bad"}]',
            setItem: () => {
                throw new Error("storage blocked");
            },
        });
        expect(cameraFlipForChannel("front", trip("camera-a"))).toEqual(unchanged);
        saveCameraFlip("front", horizontal, trip("camera-a"));
        expect(cameraFlipForChannel("front", trip("camera-a"))).toEqual(horizontal);
    });
});

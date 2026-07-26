// Tests for canReencodeH264. Three cases:
//  - no VideoEncoder in the environment (jsdom / old browser) -> false.
//  - VideoEncoder present, isConfigSupported rejects the High config -> false.
//  - VideoEncoder present, config supported -> true.
//
// canReencodeH264 delegates to mediabunny's canEncodeVideo, which reads the bare
// `VideoEncoder` global (not window.VideoEncoder) and memoizes the result per
// config for the tab lifetime. mediabunny does not re-export its memo map, so we
// give each case DISTINCT output dimensions - distinct config = distinct memo
// key - rather than trying to clear a shared cache.

import { afterEach, describe, expect, it, vi } from "vitest";

import { canReencodeH264, resolveEncodableH264, resolveEncodeAudioCodec } from "./capabilities.js";

describe("canReencodeH264", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("no VideoEncoder in the environment -> false", async () => {
        // Node-vitest has no VideoEncoder global; mediabunny short-circuits to false.
        await expect(canReencodeH264(1280, 720, 3_686_400)).resolves.toBe(false);
    });

    it("VideoEncoder rejects the High-profile config -> false", async () => {
        vi.stubGlobal("VideoEncoder", {
            isConfigSupported: async () => ({ supported: false }),
        });
        await expect(canReencodeH264(1100, 620, 3_000_000)).resolves.toBe(false);
    });

    it("VideoEncoder accepts the config -> true", async () => {
        vi.stubGlobal("VideoEncoder", {
            isConfigSupported: async () => ({ supported: true }),
        });
        await expect(canReencodeH264(1920, 1080, 8_000_000)).resolves.toBe(true);
    });
});

// resolveEncodeAudioCodec probes a FIXED config (AUDIO_TARGET_* from types.ts)
// against ["aac", "opus"]. We lock the load-bearing contract: with no encoder at
// all it degrades to null (never an uncaught throw) - the pipeline turns that
// null into "drop audio + notify" instead of crashing mid-export. (Asserting the
// aac-vs-opus PICK needs a real AudioEncoder, exercised end-to-end in the browser.)
describe("resolveEncodeAudioCodec", () => {
    it("no AudioEncoder in the environment -> null (never throws)", async () => {
        // Node-vitest has no AudioEncoder global; mediabunny finds nothing encodable.
        await expect(resolveEncodeAudioCodec()).resolves.toBeNull();
    });
});

// resolveEncodableH264 binary-searches for the device's real bitrate ceiling.
// mediabunny memoizes canEncodeVideo per-config for the tab lifetime with no
// public cache reset, so every case below uses DISTINCT dimensions - distinct
// config = distinct memo key - to stay isolated from the cases above and from
// each other.
describe("resolveEncodableH264", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("no VideoEncoder -> null (nothing encodable)", async () => {
        await expect(resolveEncodableH264(640, 480, 4_000_000)).resolves.toBeNull();
    });

    it("device handles the desired bitrate -> full bitrate, not degraded", async () => {
        vi.stubGlobal("VideoEncoder", {
            isConfigSupported: async () => ({ supported: true }),
        });
        // 1600x1200, desired 10 Mbps - the first (desired) probe passes.
        await expect(resolveEncodableH264(1600, 1200, 10_000_000)).resolves.toEqual({
            bitrate: 10_000_000,
            degraded: false,
        });
    });

    it("device caps below desired -> converges near the real ceiling, degraded", async () => {
        // Accept only bitrates <= 3 Mbps. 1280x960 base = 1280*960*4 = 4_915_200,
        // floor (0.25x) = 1_228_800 - well below the real 3 Mbps ceiling, so the
        // search has room to climb. A fixed ladder would have stopped at the
        // 2_457_600 (0.5x) rung, wasting ~18% of the device's real headroom;
        // the search instead lands within SEARCH_STOP_BPS (200 kbps) of 3 Mbps.
        vi.stubGlobal("VideoEncoder", {
            isConfigSupported: async (config: { bitrate: number }) => ({
                supported: config.bitrate <= 3_000_000,
            }),
        });
        const result = await resolveEncodableH264(1280, 960, 9_000_000);
        expect(result?.degraded).toBe(true);
        expect(result?.bitrate).toBeLessThanOrEqual(3_000_000);
        expect(result?.bitrate).toBeGreaterThan(2_457_600);
    });

    it("device cannot encode even the floor -> null", async () => {
        // Accept nothing (threshold below the floor). 960x720 base = 2_764_800,
        // floor (0.25x) = 691_200, still rejected.
        vi.stubGlobal("VideoEncoder", {
            isConfigSupported: async (config: { bitrate: number }) => ({
                supported: config.bitrate <= 100_000,
            }),
        });
        await expect(resolveEncodableH264(960, 720, 8_000_000)).resolves.toBeNull();
    });
});

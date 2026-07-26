import { describe, expect, it } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import { planEmbeddedGpsQueue } from "./embedded-gps-queue.js";

function vf(name: string, relativePath = name): VendorFile {
    return { file: new File([new Uint8Array(0)], name), relativePath };
}

// Embedded-GPS source-hint sample names (see src/parsers/gps-source-hints.ts):
const JUSCAR_TS = vf("20260512_150820F.ts", "front/20260512_150820F.ts"); // source "embedded", MPEG-TS (no moov)
const MAI_MP4 = vf("NO20240702-094820-000029F.mp4"); // source "embedded", MP4 (has moov)
const DDPAI_MP4 = vf("20240702094820_00123.mp4"); // source "basename-sidecar"
const EACE_MP4 = vf("20240702_094820F.mp4"); // source "embedded" since the Type-4 RC4 variant landed
const FITCAMX_TS = vf("20240702094820_000123A.ts"); // source "none" (PMT carries no data stream)
// The bare YYYYMMDD_HHMMSS shape is deliberately NOT claimed by the e-ace
// hint (too generic - unknown Novatek clones with real embedded GPS use it),
// so it falls through to "unknown" and gets probed.
const GENERIC_MP4 = vf("20240702_094820.mp4");

describe("planEmbeddedGpsQueue", () => {
    it("queues a moov-less embedded container (MPEG-TS / Juscar) - the no-GPS regression", () => {
        // Regression: gating the queue on moov bytes dropped every TS file from
        // extraction. The queue decision must be moov-independent.
        expect(planEmbeddedGpsQueue(JUSCAR_TS, false, /* hasMoovBytes */ false)).toEqual({
            queue: true,
            cacheMoov: false,
        });
    });

    it("queues an MP4 embedded source and caches its moov bytes", () => {
        expect(planEmbeddedGpsQueue(MAI_MP4, false, /* hasMoovBytes */ true)).toEqual({
            queue: true,
            cacheMoov: true,
        });
    });

    it("queues an embedded MP4 even when moov bytes were not produced", () => {
        // Defensive: the queue does not hinge on moov caching for MP4 either.
        expect(planEmbeddedGpsQueue(MAI_MP4, false, /* hasMoovBytes */ false)).toEqual({
            queue: true,
            cacheMoov: false,
        });
    });

    it("does not queue when a sidecar/log already produced records", () => {
        expect(planEmbeddedGpsQueue(JUSCAR_TS, /* hasExistingRecords */ true, true)).toEqual({
            queue: false,
            cacheMoov: false,
        });
    });

    it("queues a generic-shaped basename-sidecar source when no sidecar records exist", () => {
        // The 14-digit+counter shape is not DDPai-specific: a lookalike camera
        // with embedded GPS must still be probed when the sidecar is absent
        // (the ddpai-normal hint carries probeIfNoRecords).
        expect(planEmbeddedGpsQueue(DDPAI_MP4, false, true)).toEqual({ queue: true, cacheMoov: true });
    });

    it("does not queue a basename-sidecar source once its sidecar produced records", () => {
        expect(planEmbeddedGpsQueue(DDPAI_MP4, /* hasExistingRecords */ true, true)).toEqual({
            queue: false,
            cacheMoov: false,
        });
    });

    it("does not queue a distinctively-shaped basename-sidecar source (unconditional skip)", () => {
        // S_-prefixed timelapse names are DDPai-specific, so the IO-saving
        // hard skip applies even without records.
        const ddpaiTimelapse = vf("S_20240702094820_00123_0060.mp4");
        expect(planEmbeddedGpsQueue(ddpaiTimelapse, false, true)).toEqual({ queue: false, cacheMoov: false });
    });

    it("does not queue a source-hint=none file", () => {
        expect(planEmbeddedGpsQueue(FITCAMX_TS, false, true)).toEqual({ queue: false, cacheMoov: false });
    });

    it("queues a channel-suffixed E-Ace name (hint flipped to embedded with the Type-4 decoder)", () => {
        // Regression for the hint flip: before the RC4 variant the e-ace hint
        // said "none" and these files were never probed.
        expect(planEmbeddedGpsQueue(EACE_MP4, false, true)).toEqual({ queue: true, cacheMoov: true });
    });

    it("queues a generic YYYYMMDD_HHMMSS name (unknown source, safe-default probe)", () => {
        // Regression for the over-broad e-ace hint: the suffix-less generic
        // shape used to classify "none" and silently lost embedded GPS on
        // unknown cameras using that naming.
        expect(planEmbeddedGpsQueue(GENERIC_MP4, false, true)).toEqual({ queue: true, cacheMoov: true });
    });
});

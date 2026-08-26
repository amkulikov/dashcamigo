import { describe, expect, it } from "vitest";

import { buildProvisionalCandidate, checkCanPlay } from "./ingest-candidate.js";

describe("checkCanPlay", () => {
    it("keeps HEVC playable when the native path can outlive a WebCodecs rejection", async () => {
        const candidate = buildProvisionalCandidate({
            file: {
                file: new File([new Uint8Array(16)], "clip.mp4"),
                relativePath: "CARD/clip.mp4",
            },
            fingerprint: "hevc-camera",
            startUtc: 0,
            startSource: "name",
            cameraTzSec: null,
            durationSec: 60,
            records: [],
            appliedExtractors: [],
        });
        candidate.codec = "hevc";
        candidate.codecParam = "hvc1";
        candidate.videoCodecString = "hev1.1.6.L150";
        candidate.canPlay = false;

        await checkCanPlay([candidate]);

        expect(candidate.canPlay).toBe(true);
    });
});

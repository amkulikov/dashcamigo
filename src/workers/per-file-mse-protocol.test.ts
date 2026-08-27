import { describe, expect, it } from "vitest";
import { getMseAdpcmPlaybackCodecs } from "./per-file-mse-protocol.js";

describe("getMseAdpcmPlaybackCodecs", () => {
    it("prefers Opus when MSE can play both live encode targets", () => {
        expect(getMseAdpcmPlaybackCodecs(() => true)).toEqual(["opus", "aac"]);
    });

    it("keeps Safari on AAC when MSE rejects Opus-in-MP4", () => {
        expect(getMseAdpcmPlaybackCodecs((mime) => mime.includes("mp4a.40.2"))).toEqual(["aac"]);
    });

    it("returns no target when MSE rejects both codecs", () => {
        expect(getMseAdpcmPlaybackCodecs(() => false)).toEqual([]);
    });
});

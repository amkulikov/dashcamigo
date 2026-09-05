import { bench, describe } from "vitest";

import { createRegionBlurResolver } from "./blur-region-resolver.js";
import { createBlurRegion, resolveRegionBlursAt } from "./blur-regions.js";
import type { Channel } from "./parsers/types.js";

// Synthetic ten-minute export: four cameras, one five-second track starting
// every second per camera. No model, video or private sample affects the timing.
const channels: Channel[] = ["front", "rear", "interior", "side"];
const regions = Array.from({ length: 2400 }, (_, i) => {
    const start = Math.floor(i / 4);
    return createBlurRegion(channels[i % 4]!, "pixelate", start, start + 5, start, {
        xPct: (i % 7) / 10,
        yPct: 0.2,
        wPct: 0.1,
        hPct: 0.1,
    });
});

describe("blur resolution: ten minutes, four cameras, 2400 tracks at 30 fps", () => {
    bench("full scan", () => {
        let covers = 0;
        for (let frame = 0; frame < 18_000; frame++) {
            for (const channel of channels) covers += resolveRegionBlursAt(regions, channel, frame / 30).length;
        }
        if (covers !== 361_180) throw new Error("unexpected blur coverage");
    });
    bench("indexed snapshot, including setup", () => {
        const resolvers = channels.map((channel) => createRegionBlurResolver(regions, channel));
        let covers = 0;
        for (let frame = 0; frame < 18_000; frame++) {
            for (const resolve of resolvers) covers += resolve(frame / 30).length;
        }
        if (covers !== 361_180) throw new Error("unexpected blur coverage");
    });
});

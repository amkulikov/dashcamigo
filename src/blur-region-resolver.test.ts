import { describe, expect, it } from "vitest";

import { createRegionBlurResolver } from "./blur-region-resolver.js";
import { createBlurRegion, resolveRegionBlursAt, upsertKeyframe } from "./blur-regions.js";
import type { Channel } from "./parsers/types.js";

const channels: Channel[] = ["front", "rear", "interior", "side"];

describe("createRegionBlurResolver", () => {
    it("preserves interpolation, inclusive edges and paint order across held frames and backward jumps", () => {
        // Creation order deliberately differs from start time. Equal-style
        // overlapping patches must retain their original relative paint order.
        const regions = Array.from({ length: 240 }, (_, i) => {
            const start = ((i * 37) % 80) / 2;
            const region = createBlurRegion(
                channels[i % channels.length]!,
                i % 5 === 0 ? "fill" : i % 3 === 0 ? "blur" : "pixelate",
                start,
                start + (i % 9),
                start + 0.25,
                { xPct: (i % 7) / 10, yPct: 0.2, wPct: 0.12, hPct: 0.1 },
            );
            upsertKeyframe(region, start + 4, { xPct: 0.1, yPct: 0.7, wPct: 0.2, hPct: 0.15 }, false);
            return region;
        });
        const original = structuredClone(regions);
        const resolvers = channels.map((channel) => createRegionBlurResolver(regions, channel));
        const times = [
            -1,
            ...Array.from({ length: 201 }, (_, i) => i / 4),
            18.25,
            18.25,
            18.25,
            19,
            0,
            40,
            7,
            100,
            0,
            0.25,
            0.5,
        ];
        for (const sec of times) {
            for (const [i, channel] of channels.entries()) {
                expect(resolvers[i]!(sec), `${channel} at ${sec}`).toEqual(resolveRegionBlursAt(regions, channel, sec));
            }
        }
        expect(regions).toEqual(original);
    });

    it("keeps channel clocks independent when another slot holds its last frame", () => {
        const regions = channels.map((channel) =>
            createBlurRegion(channel, "fill", 2, 3, 2, { xPct: 0.2, yPct: 0.3, wPct: 0.2, hPct: 0.2 }),
        );
        const front = createRegionBlurResolver(regions, "front");
        const rear = createRegionBlurResolver(regions, "rear");
        expect(front(2)).toHaveLength(1);
        expect(rear(3)).toHaveLength(1);
        expect(front(4)).toEqual([]);
        expect(rear(3)).toHaveLength(1);
        expect(rear(3.01)).toEqual([]);
        expect(front(2)).toHaveLength(1);
    });

    it("handles empty channels, empty tracks and invalid timestamps without losing later masks", () => {
        const region = createBlurRegion("front", "fill", 0, 2, 0, { xPct: 0.2, yPct: 0.3, wPct: 0.2, hPct: 0.2 });
        const empty = { ...region, keyframes: [] };
        const resolve = createRegionBlurResolver([empty, region], "front");
        expect(createRegionBlurResolver([region], "rear")(0)).toEqual([]);
        expect(resolve(Number.NaN)).toEqual([]);
        expect(resolve(1)).toEqual(resolveRegionBlursAt([region], "front", 1));
        expect(resolve(Infinity)).toEqual([]);
        expect(resolve(2)).toHaveLength(1);
    });
});

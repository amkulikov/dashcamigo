import { describe, expect, it } from "vitest";

import { intervalsContain, subtractIntervals, totalIntervalSec, unionIntervals } from "./interval-set.js";

describe("unionIntervals", () => {
    it("merges overlapping and adjacent intervals, keeps gaps", () => {
        const u = unionIntervals([
            { startSec: 5, endSec: 7 },
            { startSec: 0, endSec: 2 },
            { startSec: 1.5, endSec: 3 },
        ]);
        expect(u).toEqual([
            { startSec: 0, endSec: 3 },
            { startSec: 5, endSec: 7 },
        ]);
    });

    it("closes sub-sliver gaps and drops degenerate intervals", () => {
        const u = unionIntervals([
            { startSec: 0, endSec: 2 },
            { startSec: 2.03, endSec: 4 },
            { startSec: 9, endSec: 9 },
        ]);
        expect(u).toEqual([{ startSec: 0, endSec: 4 }]);
    });
});

describe("subtractIntervals", () => {
    it("uncovered range comes back whole", () => {
        expect(subtractIntervals({ startSec: 10, endSec: 20 }, [])).toEqual([{ startSec: 10, endSec: 20 }]);
    });

    it("a fully covered (or shrunk) range needs nothing", () => {
        expect(subtractIntervals({ startSec: 12, endSec: 18 }, [{ startSec: 10, endSec: 20 }])).toEqual([]);
    });

    it("a grown range needs only the new tails", () => {
        expect(subtractIntervals({ startSec: 5, endSec: 25 }, [{ startSec: 10, endSec: 20 }])).toEqual([
            { startSec: 5, endSec: 10 },
            { startSec: 20, endSec: 25 },
        ]);
    });

    it("drops sliver leftovers", () => {
        expect(subtractIntervals({ startSec: 9.97, endSec: 20 }, [{ startSec: 10, endSec: 20 }])).toEqual([]);
    });
});

describe("totalIntervalSec / intervalsContain", () => {
    it("sums lengths and answers containment with edge tolerance", () => {
        const set = [
            { startSec: 0, endSec: 2 },
            { startSec: 5, endSec: 6 },
        ];
        expect(totalIntervalSec(set)).toBeCloseTo(3);
        expect(intervalsContain(set, 1)).toBe(true);
        expect(intervalsContain(set, 2.04)).toBe(true);
        expect(intervalsContain(set, 3.5)).toBe(false);
    });
});

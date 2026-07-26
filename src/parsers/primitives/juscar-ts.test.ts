import { describe, expect, it } from "vitest";

import type { Mp4Index } from "../internal/mp4-index.js";
import type { VendorFile } from "../types.js";
import { juscarTsPrimitive } from "./juscar-ts.js";

function makeVf(name: string): VendorFile {
    return { file: new File([new Uint8Array(0)], name), relativePath: name };
}

// Minimal Mp4Index stub - hasLigoGpsMarker and empty other fields. No direct
// parse() test: that goes through extractJuscarTsGps which needs a real TS
// bytestream; the real case is covered via the real-anonymized fixture suite.
function makeIndex(hasLigoGpsMarker: boolean): Mp4Index {
    return {
        headerBytes: new Uint8Array(0),
        headerView: new DataView(new ArrayBuffer(0)),
        tracks: [],
        moov: null,
        moovView: null,
        topLevelFreeBox: null,
        freeGpsBoxInsideFree: null,
        novatekGpsAtom: null,
        navitelGps0Atom: null,
        navitelIditAtom: null,
        hasFreeGpsMarker: false,
        hasLigoGpsMarker,
    } as unknown as Mp4Index;
}

describe("juscarTsPrimitive.marker", () => {
    it("positive on matching name + hasLigoGpsMarker", async () => {
        const vf = makeVf("20260429_182640F.ts");
        expect(await juscarTsPrimitive.marker(vf, makeIndex(true))).toBe(true);
    });

    it("negative when name does not match even with marker present", async () => {
        const vf = makeVf("random.ts");
        expect(await juscarTsPrimitive.marker(vf, makeIndex(true))).toBe(false);
    });

    it("negative when name matches but hasLigoGpsMarker=false", async () => {
        const vf = makeVf("20260429_182640F.ts");
        expect(await juscarTsPrimitive.marker(vf, makeIndex(false))).toBe(false);
    });

    it("negative without index", async () => {
        const vf = makeVf("20260429_182640F.ts");
        expect(await juscarTsPrimitive.marker(vf, undefined)).toBe(false);
    });
});

describe("juscarTsPrimitive.cloneAcrossGroup", () => {
    it("matching key for front and rear of the same pair", () => {
        const front = juscarTsPrimitive.cloneAcrossGroup!(makeVf("20260429_182640F.ts"));
        const rear = juscarTsPrimitive.cloneAcrossGroup!(makeVf("20260429_182640R.ts"));
        expect(front).toBe("20260429_182640");
        expect(rear).toBe("20260429_182640");
        expect(front).toBe(rear);
    });

    it("different timestamps - different keys", () => {
        const a = juscarTsPrimitive.cloneAcrossGroup!(makeVf("20260429_182640F.ts"));
        const b = juscarTsPrimitive.cloneAcrossGroup!(makeVf("20260429_182645F.ts"));
        expect(a).not.toBe(b);
    });

    it("null for non-juscar name", () => {
        expect(juscarTsPrimitive.cloneAcrossGroup!(makeVf("random.ts"))).toBeNull();
    });
});

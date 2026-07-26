// Headless coverage for the pure ingest core. The star here is
// embeddedResultHasEffect: it is the guard that keeps the sstar-ssmd
// phantom-track gate working (0 records + a start-UTC hint must still apply),
// and nothing else in the suite exercises that branch.

import { describe, it, expect } from "vitest";

import {
    countByExtension,
    countByField,
    embeddedResultHasEffect,
    raceWithAbort,
    toVendorFiles,
} from "./ingest-core.js";
import type { DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import type { VendorFile } from "../parsers/types.js";

const fakeFile = (name: string, webkitRelativePath = ""): File => ({ name, webkitRelativePath }) as unknown as File;
const vf = (name: string): VendorFile => ({ file: { name } }) as unknown as VendorFile;

describe("toVendorFiles", () => {
    it("uses webkitRelativePath when the browser set it (directory picker)", () => {
        const out = toVendorFiles([fakeFile("F.MP4", "DCIM/Movie/F.MP4")]);
        expect(out).toEqual([{ file: expect.anything(), relativePath: "DCIM/Movie/F.MP4" }]);
    });

    it("falls back to the bare name when webkitRelativePath is empty (drag-and-drop)", () => {
        const out = toVendorFiles([fakeFile("F.MP4", "")]);
        expect(out[0]!.relativePath).toBe("F.MP4");
    });
});

describe("countByExtension", () => {
    it("groups by lowercased extension and buckets extensionless files under ''", () => {
        const counts = countByExtension([vf("a.MP4"), vf("b.mp4"), vf("c.TXT"), vf("README")]);
        expect(counts).toEqual({ ".mp4": 2, ".txt": 1, "": 1 });
    });
});

describe("countByField", () => {
    it("counts occurrences of the derived key", () => {
        expect(countByField(["front", "rear", "front"], (s) => s)).toEqual({ front: 2, rear: 1 });
    });
});

describe("embeddedResultHasEffect", () => {
    const result = (over: Partial<DispatchedEmbeddedGpsResult>): DispatchedEmbeddedGpsResult =>
        ({ records: [], videoStartUtcHintByFilename: new Map(), ...over }) as unknown as DispatchedEmbeddedGpsResult;

    it("is true when there are records", () => {
        expect(embeddedResultHasEffect(result({ records: [{} as never] }))).toBe(true);
    });

    it("is true for a hint-only result (phantom-track gate: 0 records + start-UTC hint)", () => {
        expect(
            embeddedResultHasEffect(result({ videoStartUtcHintByFilename: new Map([["f.mp4", 1_700_000_000]]) })),
        ).toBe(true);
    });

    it("is false only when there are neither records nor hints", () => {
        expect(embeddedResultHasEffect(result({}))).toBe(false);
    });
});

describe("raceWithAbort", () => {
    it("resolves with the wrapped promise when the signal never fires", async () => {
        const ac = new AbortController();
        await expect(raceWithAbort(Promise.resolve(42), ac.signal)).resolves.toBe(42);
    });

    it("propagates the wrapped promise's rejection unchanged", async () => {
        const ac = new AbortController();
        await expect(raceWithAbort(Promise.reject(new Error("boom")), ac.signal)).rejects.toThrow("boom");
    });

    it("rejects immediately with an AbortError when the signal is already aborted", async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(raceWithAbort(new Promise(() => {}), ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    });

    it("rejects with an AbortError when the signal fires while the promise is pending", async () => {
        const ac = new AbortController();
        const pending = raceWithAbort(new Promise(() => {}), ac.signal);
        ac.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
});

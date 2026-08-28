import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { VIDEO_CLONE_GROUPERS } from "./clone-groups.js";
import { VIDEO_EMBEDDED_PRIMITIVES } from "./index.js";
import { VIDEO_EMBEDDED_PRIMITIVE_CACHE_REVISIONS } from "./cache-revisions.generated.js";
import { buildEmbeddedGpsDispatchRevisions } from "./cache-revisions.js";

describe("embedded GPS cache revisions", () => {
    it("covers the dispatcher registry in exact order", () => {
        expect(VIDEO_EMBEDDED_PRIMITIVE_CACHE_REVISIONS.map((item) => item.id)).toEqual(
            VIDEO_EMBEDDED_PRIMITIVES.map((primitive) => primitive.id),
        );
    });

    it("keeps the lightweight clone registry identical to primitive declarations", () => {
        expect(VIDEO_CLONE_GROUPERS).toEqual(
            VIDEO_EMBEDDED_PRIMITIVES.filter((primitive) => primitive.cloneAcrossGroup).map((primitive) => ({
                id: primitive.id,
                cloneAcrossGroup: primitive.cloneAcrossGroup,
            })),
        );
    });

    it("tree-shakes two registry entries exported from the same source file independently", () => {
        const revisions = new Map(VIDEO_EMBEDDED_PRIMITIVE_CACHE_REVISIONS.map((item) => [item.id, item.revision]));
        expect(revisions.get("gpslog-atom-nbmt")).not.toBe(revisions.get("gpslog-atom"));
    });

    it("generates the same revisions outside the repository cwd", () => {
        const script = fileURLToPath(new URL("../../../scripts/parser-cache-revisions.mjs", import.meta.url));
        expect(() => execFileSync(process.execPath, [script, "--check"], { cwd: tmpdir() })).not.toThrow();
    });

    it("does not invalidate an earlier winner when only a later parser changes", () => {
        const before = buildEmbeddedGpsDispatchRevisions(
            [
                { id: "early", revision: "a" },
                { id: "late", revision: "b" },
            ],
            1,
        );
        const after = buildEmbeddedGpsDispatchRevisions(
            [
                { id: "early", revision: "a" },
                { id: "late", revision: "changed" },
            ],
            1,
        );

        expect(after.byExtractor.get("early")).toBe(before.byExtractor.get("early"));
        expect(after.byExtractor.get("late")).not.toBe(before.byExtractor.get("late"));
        expect(after.noMatch).not.toBe(before.noMatch);
    });

    it("invalidates later winners when an earlier parser changes or is inserted", () => {
        const before = buildEmbeddedGpsDispatchRevisions(
            [
                { id: "early", revision: "a" },
                { id: "late", revision: "b" },
            ],
            1,
        );
        const changed = buildEmbeddedGpsDispatchRevisions(
            [
                { id: "early", revision: "changed" },
                { id: "late", revision: "b" },
            ],
            1,
        );
        const inserted = buildEmbeddedGpsDispatchRevisions(
            [
                { id: "new", revision: "n" },
                { id: "early", revision: "a" },
                { id: "late", revision: "b" },
            ],
            1,
        );

        expect(changed.byExtractor.get("late")).not.toBe(before.byExtractor.get("late"));
        expect(inserted.byExtractor.get("early")).not.toBe(before.byExtractor.get("early"));
        expect(inserted.byExtractor.get("late")).not.toBe(before.byExtractor.get("late"));
    });
});

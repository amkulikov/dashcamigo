import { describe, expect, it } from "vitest";

import type { ClassifiedFile, DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import { vendorFileKey } from "../vendor-file-key.js";
import {
    buildGpsExtractRequest,
    buildGpsExtractShardRequest,
    mergeSettledGpsExtractShards,
    shardByCloneAffinity,
} from "./gps-extract-artifacts.js";

function video(name: string): ClassifiedFile {
    return {
        file: { file: new File([new Uint8Array(1)], name), relativePath: `CARD/${name}`, sourceKey: "card" },
        role: "video",
        sidecarId: null,
        sidecarMp4: null,
        logExtractorId: null,
    };
}

function emptyResult(): DispatchedEmbeddedGpsResult {
    return {
        appliedExtractors: [],
        records: [],
        skipped: [],
        errors: [],
        winningExtractorByFileKey: new Map(),
        sourceFileKeyByFileKey: new Map(),
        videoStartUtcHintByFileKey: new Map(),
        localClockOffsetHintByFileKey: new Map(),
        accelByFileKey: new Map(),
        heavyFiles: [],
    };
}

describe("GPS extraction artifact pipeline", () => {
    it("keeps clone-group peers in one shard", () => {
        const front = video("20260429_182640F.ts");
        const rear = video("20260429_182640R.ts");
        const unrelated = video("other.mp4");
        const shards = shardByCloneAffinity([front, rear, unrelated], 2);

        expect(shards.some((shard) => shard.includes(front) && shard.includes(rear))).toBe(true);
    });

    it("pins result-affecting worker request fields", () => {
        const classified = [video("clip.mp4")];
        const moov = new Map([["key", new Uint8Array([1])]]);

        expect(buildGpsExtractRequest("token", classified, "light-only", moov)).toEqual({
            token: "token",
            classified,
            concurrency: 1,
            mode: "light-only",
            prebuiltMoovByPath: moov,
        });
    });

    it("selects prebuilt moov by full identity, not a colliding basename", () => {
        const selected = video("same.mp4");
        const sibling = video("same.mp4");
        sibling.file.relativePath = "OTHER/same.mp4";
        const selectedBytes = new Uint8Array([1]);
        const siblingBytes = new Uint8Array([2]);
        const allMoov = new Map([
            [vendorFileKey(selected.file), selectedBytes],
            [vendorFileKey(sibling.file), siblingBytes],
        ]);

        const { request, transfer } = buildGpsExtractShardRequest("token", [selected], "all", allMoov);

        expect(request.prebuiltMoovByPath).toEqual(new Map([[vendorFileKey(selected.file), selectedBytes]]));
        expect(transfer).toEqual([selectedBytes.buffer]);
    });

    it("keeps healthy shards and marks every crashed-shard file retryable", () => {
        const healthy = video("healthy.mp4");
        const crashedA = video("crashed-a.mp4");
        const crashedB = video("crashed-b.mp4");
        const result = emptyResult();
        result.appliedExtractors.push("gpmf");

        const merged = mergeSettledGpsExtractShards(
            [
                { status: "fulfilled", value: result },
                { status: "rejected", reason: new Error("worker died") },
            ],
            [[healthy], [crashedA, crashedB]],
        );

        expect(merged.appliedExtractors).toEqual(["gpmf"]);
        expect(merged.errors).toEqual([
            { file: "crashed-a.mp4", extractor: "gps-extract-worker", message: "worker died" },
            { file: "crashed-b.mp4", extractor: "gps-extract-worker", message: "worker died" },
        ]);
    });

    it("propagates cancellation instead of converting it to a cacheable shard error", () => {
        const abort = new DOMException("cancelled", "AbortError");
        expect(() =>
            mergeSettledGpsExtractShards([{ status: "rejected", reason: abort }], [[video("clip.mp4")]]),
        ).toThrow(abort);
    });
});

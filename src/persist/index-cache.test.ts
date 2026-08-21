import { describe, expect, it } from "vitest";
import type { VideoCandidate } from "../trips.js";
import { approxEntryBytes, buildCacheEntry, isQuotaFailure, toCachedCandidate } from "./index-cache.js";
import { INDEX_CACHE_VERSION } from "./types.js";

function makeCandidate(): VideoCandidate {
    return {
        file: new File([new Uint8Array(16)], "NO20260730-143756-000001F.MP4", { lastModified: 1_753_900_000_000 }),
        relativePath: "DASHCAM_SD/Normal/NO20260730-143756-000001F.MP4",
        sourceKey: "session-source",
        fingerprint: "novatek-ts:cam1",
        appliedExtractors: ["novatek-gps"],
        classifierMatches: { time: "novatek", channel: "novatek", mode: "novatek", sequence: "novatek" },
        channel: "front",
        channelConfident: true,
        sequence: 1,
        recordingMode: "normal",
        isTimelapse: false,
        startUtc: 1_753_900_000,
        durationSec: 60,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "gps",
        cameraTzSec: 7200,
        localClockOffsetHintSec: null,
        createdUtc: new Date(1_753_900_000_000),
        records: [
            {
                unixSeconds: 1_753_900_001,
                active: true,
                lat: 52.1,
                lon: 13.4,
                bearingDeg: 90,
                speedMs: 13.9,
                accelXg: 0,
                accelYg: 0,
                accelZg: 0,
                mp4Filename: "NO20260730-143756-000001F.MP4",
            },
        ],
        codec: "avc",
        codecParam: "avc1",
        videoCodecString: null,
        rotation: 0,
        width: 1920,
        height: 1080,
        fps: 30,
        audio: { codec: "aac", channels: 1, sampleRate: 48000 },
        canPlay: true,
        needsHevcRemux: false,
        isTransportStream: false,
        isMatroska: false,
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
    };
}

describe("toCachedCandidate", () => {
    it("strips the live File and session source while keeping persistent fields", () => {
        const candidate = makeCandidate();
        const cached = toCachedCandidate(candidate);
        expect("file" in cached, "file must not be stored").toBe(false);
        expect("sourceKey" in cached, "session source must not be stored").toBe(false);
        const { file: _file, sourceKey: _sourceKey, ...rest } = candidate;
        expect(cached).toEqual(rest);
    });

    it("round-trips into an equal candidate when re-attached to a fresh File", () => {
        const candidate = makeCandidate();
        const cached = toCachedCandidate(candidate);
        const freshFile = new File([new Uint8Array(16)], candidate.file.name, {
            lastModified: candidate.file.lastModified,
        });
        const rebuilt: VideoCandidate = { ...cached, file: freshFile, sourceKey: candidate.sourceKey };
        expect(rebuilt).toEqual({ ...candidate, file: freshFile });
        expect(rebuilt.records[0]!.lat, "records survive").toBeCloseTo(52.1);
        expect(rebuilt.createdUtc?.getTime(), "Date survives").toBe(1_753_900_000_000);
    });
});

describe("buildCacheEntry", () => {
    it("stamps the current cache version and omits repair when absent", () => {
        const entry = buildCacheEntry("some-key", makeCandidate(), undefined, "deps");
        expect(entry.version).toBe(INDEX_CACHE_VERSION);
        expect(entry.identityKey).toBe("some-key");
        expect(entry.dependencyKey).toBe("deps");
        expect("repair" in entry).toBe(false);
    });

    it("carries the repair descriptor when the indexer patched the moov", () => {
        const repair = {
            patchedMoov: new Uint8Array([1, 2, 3]),
            moovFileStart: 8,
            moovFileEnd: 11,
            phantomNeutralized: ["soun"],
            hvcc: null,
        };
        const entry = buildCacheEntry("some-key", makeCandidate(), repair, "deps");
        expect(entry.repair).toEqual(repair);
    });

    it("stamps an approximate size so the volume prune can weigh the entry", () => {
        const entry = buildCacheEntry("some-key", makeCandidate(), undefined, "deps");
        expect(entry.bytes).toBe(approxEntryBytes(entry.candidate, undefined));
        expect(entry.bytes ?? 0, "an entry with records weighs something real").toBeGreaterThan(300);
    });
});

describe("approxEntryBytes", () => {
    it("grows with the record count - GPS-dense clips must weigh more", () => {
        const sparse = toCachedCandidate(makeCandidate());
        const dense = {
            ...sparse,
            records: Array.from({ length: 200 }, (_, i) => ({ ...sparse.records[0]!, unixSeconds: i })),
        };
        expect(approxEntryBytes(dense, undefined)).toBeGreaterThan(approxEntryBytes(sparse, undefined) * 10);
    });

    it("counts the patched moov by its raw length, not its JSON blowup", () => {
        const candidate = toCachedCandidate(makeCandidate());
        const repair = {
            patchedMoov: new Uint8Array(10_000),
            moovFileStart: 8,
            moovFileEnd: 10_008,
            phantomNeutralized: [],
            hvcc: null,
        };
        const withRepair = approxEntryBytes(candidate, repair);
        const without = approxEntryBytes(candidate, undefined);
        expect(withRepair - without).toBeGreaterThanOrEqual(10_000);
        // JSON.stringify of a 10KB Uint8Array would be ~40KB of digits and
        // commas - the estimate must stay near the raw buffer size instead.
        expect(withRepair - without).toBeLessThan(15_000);
    });
});

describe("isQuotaFailure", () => {
    const quota = new DOMException("out of room", "QuotaExceededError");
    const abort = new DOMException("aborted", "AbortError");

    it("finds the quota rejection behind the abort that was actually thrown", () => {
        // The shape the write really fails in: the put hits the quota, its
        // unhandled error aborts the transaction, and the total-bytes read
        // awaited first surfaces as AbortError. Reading only what was thrown
        // is what left the store unable to ever evict.
        expect(isQuotaFailure([abort, quota, quota])).toBe(true);
    });

    it("finds it in the transaction error when the put rejection has not settled", () => {
        expect(isQuotaFailure([abort, undefined, quota])).toBe(true);
    });

    it("accepts the legacy numeric code, which the standard exception also carries", () => {
        // Kept for an engine that reports the old QUOTA_EXCEEDED_ERR name; a
        // spec-compliant DOMException answers to both, so the clause can only
        // ever widen the match.
        expect(quota.code).toBe(22);
        expect(isQuotaFailure([quota])).toBe(true);
    });

    it("leaves an abort that is not about room alone - eviction would not help it", () => {
        // A version change or a browser-closed connection: throwing entries
        // away costs the user their cache and fixes nothing.
        expect(isQuotaFailure([abort, undefined, abort])).toBe(false);
        expect(isQuotaFailure([new Error("QuotaExceededError")]), "a plain Error is not the DOM one").toBe(false);
        expect(isQuotaFailure([null, undefined])).toBe(false);
    });
});

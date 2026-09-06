// Round-trip test for the gpmd injector:
//   1. Take a real MP4 without a gpmd track (MOV_0581.mp4 fixture - ffmpeg
//      testsrc2 with video+audio, no metadata tracks).
//   2. Wrap it in an in-memory fake FileSystemFileHandle.
//   3. Pack synthetic GpsRecords via packGpmfSamples.
//   4. Run injectGpmdTrack.
//   5. Read the resulting MP4 using the same code as the ingest pipeline:
//      buildMp4Index → findGpmdTrack → extractFromGpmdTrack.
//   6. Asserts:
//      - a gpmd track appeared in the index (handler='meta', sample-format='gpmd');
//      - extracted records match what we packed (within scaling truncation
//        and the isStreamFixUsable filter from extractFromGpmdTrack);
//      - original video/audio tracks are intact.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { injectClipGpmf, injectGpmdTrack } from "./gpmd-inject.js";
import { packGpmfSamples } from "../parsers/internal/gpmf-pack.js";
import { buildMp4Index } from "../parsers/internal/mp4-index.js";
import { extractFromGpmdTrack, findGpmdTrack } from "../parsers/internal/gpmf-extract.js";
import { buildTripTimeline, type TripFrame } from "../trips.js";
import type { GpsRecord } from "../parsers/types.js";

// Packs a gapless clip starting at the given UTC (content 0 == clipStartUtc) -
// these round-trip tests have no recording pause, so a single-segment identity
// timeline reproduces the old wall-clock behavior.
function packAtUtc(
    records: readonly GpsRecord[],
    clipStartUtc: number,
    durationSec: number,
    opts: { includeAccel: boolean },
): ReturnType<typeof packGpmfSamples> {
    const frame: TripFrame = { startUtc: clipStartUtc, durationSec: 100_000, wallDurationSec: 100_000, channels: {} };
    return packGpmfSamples(records, buildTripTimeline([frame]), 0, durationSec, opts);
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_MP4 = resolve(REPO_ROOT, "tests/testdata/dashcam-viewer-corpus/MOV_0581.mp4");

/**
 * In-memory fake FileSystemFileHandle, sufficient for injectGpmdTrack.
 * Stores bytes in a plain Uint8Array; getFile() wraps the current buffer in
 * a File; createWritable() returns a writable that mutates the buffer at
 * absolute positions (required for the position field in FSA-write chunks).
 */
function makeFakeHandle(initial: Uint8Array, onWrite?: () => void): FileSystemFileHandle {
    let buf = new Uint8Array(initial);

    const handle = {
        kind: "file" as const,
        name: "test.mp4",
        async getFile(): Promise<File> {
            return new File([buf], "test.mp4", { type: "video/mp4" });
        },
        async createWritable(_opts?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream> {
            // Snapshot the start buffer (keepExistingData=true).
            // injectGpmdTrack always passes keepExistingData=true; no need
            // for two modes in the test.
            let writeBuf = new Uint8Array(buf);

            const writable = {
                async write(chunk: { type: string; position: number; data: Uint8Array }): Promise<void> {
                    if (chunk.type !== "write") throw new Error(`unsupported chunk type: ${chunk.type}`);
                    const end = chunk.position + chunk.data.byteLength;
                    if (end > writeBuf.byteLength) {
                        const grown = new Uint8Array(end);
                        grown.set(writeBuf);
                        writeBuf = grown;
                    }
                    writeBuf.set(chunk.data, chunk.position);
                    onWrite?.();
                },
                async truncate(size: number): Promise<void> {
                    if (size === writeBuf.byteLength) return;
                    if (size < writeBuf.byteLength) {
                        writeBuf = writeBuf.slice(0, size);
                    } else {
                        const grown = new Uint8Array(size);
                        grown.set(writeBuf);
                        writeBuf = grown;
                    }
                },
                async seek(_pos: number): Promise<void> {
                    // not used by injectGpmdTrack - position-based writes
                },
                async close(): Promise<void> {
                    buf = writeBuf;
                },
                async abort(_reason?: unknown): Promise<void> {
                    // discard writeBuf
                },
            };
            return writable as unknown as FileSystemWritableFileStream;
        },
        async queryPermission(): Promise<PermissionState> {
            return "granted";
        },
        async requestPermission(): Promise<PermissionState> {
            return "granted";
        },
        async isSameEntry(_other: FileSystemHandle): Promise<boolean> {
            return false;
        },
    };
    return handle as unknown as FileSystemFileHandle;
}

function makeRecord(overrides: Partial<GpsRecord>): GpsRecord {
    return {
        unixSeconds: 0,
        active: true,
        lat: 0,
        lon: 0,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "",
        ...overrides,
    };
}

describe("injectGpmdTrack - end-to-end round-trip on real mp4 fixture", () => {
    const baseUtc = Date.UTC(2026, 4, 8, 12, 30, 45) / 1000; // 2026-05-08 12:30:45 UTC
    // Records on whole seconds. With 1 Hz sampling there is one record per
    // second → extractFromGps5 decodes it as baseUnix (start of the GPSU
    // block, also a whole second). Using fractional seconds is pointless:
    // pack rounds to the second bucket and time comes out as the bucket start.
    const records: GpsRecord[] = [
        makeRecord({ unixSeconds: baseUtc + 0, lat: 55.7558, lon: 37.6173, speedMs: 12.34 }),
        makeRecord({ unixSeconds: baseUtc + 1, lat: 55.756, lon: 37.6175, speedMs: 12.5 }),
        makeRecord({ unixSeconds: baseUtc + 2, lat: 55.7562, lon: 37.6177, speedMs: 12.6 }),
    ];

    it("injects gpmd track into mp4 without one", async () => {
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const handle = makeFakeHandle(original);

        const samples = packAtUtc(records, baseUtc, 3, { includeAccel: false });
        await injectGpmdTrack(handle, samples);

        // Re-read the file via the ingest pipeline.
        const mutatedFile = await handle.getFile();
        expect(mutatedFile.size).toBeGreaterThan(original.byteLength);

        const index = await buildMp4Index(mutatedFile);
        const gpmdTrack = findGpmdTrack(index);
        expect(gpmdTrack).not.toBeNull();

        const extracted = await extractFromGpmdTrack(
            { file: mutatedFile, relativePath: "test.mp4" },
            index,
            gpmdTrack!,
        );
        expect(extracted).not.toBeNull();
        expect(extracted!.records).toHaveLength(3);

        // Tolerance for scaling truncation (1e-7 on coordinates, 1e-3 on speed).
        for (let i = 0; i < records.length; i++) {
            const orig = records[i]!;
            const got = extracted!.records[i]!;
            expect(got.lat).toBeCloseTo(orig.lat, 6);
            expect(got.lon).toBeCloseTo(orig.lon, 6);
            expect(got.speedMs).toBeCloseTo(orig.speedMs, 3);
            // GPSU - "yymmddhhmmss.sss" with ms precision. On whole seconds
            // the discrepancy should be within one ms rounding error.
            expect(got.unixSeconds).toBeCloseTo(orig.unixSeconds, 2);
        }
    });

    it("ACCL round-trip: pack with non-zero accel → extract gives same accel back", async () => {
        // Regression for troubles/dashcamigo_20260429_192226.mp4: GPS worked
        // after the first iteration but the accelerometer "disappeared". Root
        // cause was two-fold:
        //  1) packer wrote ACCL only for seconds where accel != 0 (broken
        //     stream for readers) - fixed in gpmf-pack.ts.
        //  2) ingest-extractor never extracted the ACCL stream (hardcoded
        //     accelXg/Yg/Zg = 0 in extractFromGps5/9) - fixed here.
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const handle = makeFakeHandle(original);

        const accelRecords: GpsRecord[] = [
            makeRecord({
                unixSeconds: baseUtc + 0,
                lat: 55.75,
                lon: 37.6,
                accelXg: 0.12,
                accelYg: -0.05,
                accelZg: 0.03,
            }),
            // Second second has no explicit accel (zeros by default). After the
            // pack fix it should get a placeholder ACCL=0,0,0 in the file.
            makeRecord({ unixSeconds: baseUtc + 1, lat: 55.76, lon: 37.61 }),
            makeRecord({
                unixSeconds: baseUtc + 2,
                lat: 55.77,
                lon: 37.62,
                accelXg: -0.08,
                accelYg: 0.02,
                accelZg: -0.01,
            }),
        ];
        const samples = packAtUtc(accelRecords, baseUtc, 3, { includeAccel: true });
        await injectGpmdTrack(handle, samples);

        const mutated = await handle.getFile();
        const index = await buildMp4Index(mutated);
        const gpmd = findGpmdTrack(index);
        expect(gpmd).not.toBeNull();

        const result = await extractFromGpmdTrack({ file: mutated, relativePath: "test.mp4" }, index, gpmd!);
        expect(result).not.toBeNull();
        expect(result!.records).toHaveLength(3);

        // Tolerance: g→m/s²×1000 is packed as int32 then divided back -
        // residual error ~5e-4 g (1 mm/s² / 9.80665). Compare with tol 3e-3.
        const TOL = 3e-3;
        for (let i = 0; i < accelRecords.length; i++) {
            const orig = accelRecords[i]!;
            const got = result!.records[i]!;
            expect(got.accelXg).toBeCloseTo(orig.accelXg, 2);
            expect(got.accelYg).toBeCloseTo(orig.accelYg, 2);
            expect(got.accelZg).toBeCloseTo(orig.accelZg, 2);
            // Middle second should be strictly near zero.
            if (i === 1) {
                expect(Math.abs(got.accelXg)).toBeLessThan(TOL);
                expect(Math.abs(got.accelYg)).toBeLessThan(TOL);
                expect(Math.abs(got.accelZg)).toBeLessThan(TOL);
            }
        }
    });

    it("preserves original video and audio tracks", async () => {
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const handle = makeFakeHandle(original);

        // Inspect the original set of tracks first.
        const origFile = new File([original], "test.mp4", { type: "video/mp4" });
        const origIndex = await buildMp4Index(origFile);
        const origTrackCount = origIndex.tracks.length;
        const origVideoCount = origIndex.tracks.filter((t) => t.handlerType === "vide").length;
        const origAudioCount = origIndex.tracks.filter((t) => t.handlerType === "soun").length;

        const samples = packAtUtc(records, baseUtc, 3, { includeAccel: false });
        await injectGpmdTrack(handle, samples);

        const mutatedFile = await handle.getFile();
        const newIndex = await buildMp4Index(mutatedFile);

        // +1 track total (gpmd); video and audio counts unchanged.
        expect(newIndex.tracks.length).toBe(origTrackCount + 1);
        expect(newIndex.tracks.filter((t) => t.handlerType === "vide").length).toBe(origVideoCount);
        expect(newIndex.tracks.filter((t) => t.handlerType === "soun").length).toBe(origAudioCount);
        expect(newIndex.tracks.filter((t) => t.handlerType === "meta").length).toBeGreaterThanOrEqual(1);
    });

    it("keeps the finished video when metadata exceeds the GPMF sample limit", async () => {
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const handle = makeFakeHandle(original);
        const frame: TripFrame = { startUtc: baseUtc, durationSec: 1, wallDurationSec: 1, channels: {} };
        const trip = {
            timeline: buildTripTimeline([frame]),
            records: Array.from({ length: 4096 }, (_, i) =>
                makeRecord({ unixSeconds: baseUtc + i / 4096, lat: 55, lon: 37 }),
            ),
        };
        expect(() => packGpmfSamples(trip.records, trip.timeline, 0, 1)).toThrow("repeat out of uint16 range");
        await expect(injectClipGpmf({ handle, trip, clipContentStartSec: 0, clipContentEndSec: 1 })).resolves.toBe(
            false,
        );
        expect(Buffer.from(await (await handle.getFile()).arrayBuffer()).equals(original)).toBe(true);
    });

    it("rolls back telemetry writes when cancellation arrives before commit", async () => {
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const controller = new AbortController();
        const handle = makeFakeHandle(original, () => controller.abort());
        const samples = packAtUtc(records, baseUtc, 3, { includeAccel: false });
        await expect(injectGpmdTrack(handle, samples, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(Buffer.from(await (await handle.getFile()).arrayBuffer()).equals(original)).toBe(true);
    });

    it("propagates a non-DOM AbortError from the file boundary", async () => {
        const original = new Uint8Array(readFileSync(FIXTURE_MP4));
        const handle = makeFakeHandle(original);
        const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" });
        handle.getFile = async () => {
            throw aborted;
        };
        const frame: TripFrame = { startUtc: baseUtc, durationSec: 3, wallDurationSec: 3, channels: {} };
        await expect(
            injectClipGpmf({
                handle,
                trip: { records, timeline: buildTripTimeline([frame]) },
                clipContentStartSec: 0,
                clipContentEndSec: 3,
            }),
        ).rejects.toBe(aborted);
    });
});

// Parser test utilities. Not included in the app bundle - vitest picks up
// __fixtures__ automatically; vite never imports from here.

import { expect } from "vitest";

import type { GpsRecord, VendorFile } from "../types.ts";

// Constructs a VendorFile from a string or bytes. Node 20+ File supports
// text()/arrayBuffer()/slice() which is enough for all text parsers. For
// binary embedded formats (Novatek freeGPS, GPMF) pass an ArrayBuffer/Blob.
export function makeVendorFile(
    relativePath: string,
    content: BlobPart,
    fileName?: string
): VendorFile {
    // Default name is the last path segment, matching how the browser sets
    // File.name during webkitdirectory ingest.
    const segments = relativePath.split("/");
    const lastSegment = segments[segments.length - 1];
    const name = fileName ?? lastSegment ?? relativePath;
    const file = new File([content], name);
    return { file, relativePath };
}

/**
 * Asserts a parsed GPS track is semantically plausible, not merely "shaped like
 * last time". Complements toMatchSnapshot(): a snapshot blesses whatever the
 * parser first produced, so a sign flip / lat-lon swap / time regression that a
 * `-u` update silently accepts is caught here instead. Checks:
 *   - at least `minCount` records and at least one active fix;
 *   - every ACTIVE record's lat/lon is finite and in range (inactive/lost-fix
 *     records may legitimately carry NaN - see isFinitePosition);
 *   - time-synced records are monotonic non-decreasing in unixSeconds.
 */
export function expectPlausibleGpsTrack(
    records: GpsRecord[],
    opts: { minCount?: number; monotonicTime?: boolean } = {},
): void {
    const { minCount = 1, monotonicTime = true } = opts;
    expect(records.length, "record count").toBeGreaterThanOrEqual(minCount);

    const active = records.filter((r) => r.active);
    expect(active.length, "at least one active GPS fix").toBeGreaterThanOrEqual(1);
    for (const [i, r] of active.entries()) {
        expect(Number.isFinite(r.lat) && r.lat >= -90 && r.lat <= 90, `active lat[${i}] out of range: ${r.lat}`).toBe(
            true,
        );
        expect(
            Number.isFinite(r.lon) && r.lon >= -180 && r.lon <= 180,
            `active lon[${i}] out of range: ${r.lon}`,
        ).toBe(true);
    }

    if (monotonicTime) {
        const synced = records.filter((r) => !r.timeUnsynced);
        for (let i = 1; i < synced.length; i++) {
            expect(
                synced[i]!.unixSeconds,
                `unixSeconds must not go backwards at index ${i}`,
            ).toBeGreaterThanOrEqual(synced[i - 1]!.unixSeconds);
        }
    }
}

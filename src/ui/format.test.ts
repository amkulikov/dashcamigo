// Formatter tests. Currently only clipBasename; the logic is pure and cheap to cover without DOM/i18n deps.

import { describe, it, expect } from "vitest";
import { clipBasename, dateBucketLabel, formatTripTitle } from "./format.js";
import { t } from "../i18n/index.js";
import { buildTripTimeline, type Trip, type TripFrame } from "../trips.js";

/**
 * Minimal fake Trip - clipBasename needs startUtc and a timeline. A single
 * gapless segment anchored at startUtc makes contentToWallUtc an identity
 * offset (footage second N == startUtc + N), matching a pause-free trip.
 */
function makeTrip(startUtc: number): Trip {
    const frame: TripFrame = { startUtc, durationSec: 100_000, wallDurationSec: 100_000, channels: {} };
    return { startUtc, timeline: buildTripTimeline([frame]) } as unknown as Trip;
}

describe("clipBasename", () => {
    it("typical same-day clip uses compact end-time (HHMMSS without date)", () => {
        // 2026-04-29 19:27:47 local + 28 sec → 19:28:15 same day.
        // UTC seconds from Date with local getters - mirrors browser-side behavior.
        const start = new Date(2026, 3, 29, 19, 27, 47).getTime() / 1000;
        const trip = makeTrip(start);
        const name = clipBasename(trip, 0, 28);
        expect(name).toBe("dashcamigo_20260429_192747-192815");
    });

    it("zero-length range still produces both timestamps", () => {
        // Defensive: caller should not pass end=start, but if it happens the name must still be valid.
        const start = new Date(2026, 3, 29, 19, 27, 47).getTime() / 1000;
        const trip = makeTrip(start);
        const name = clipBasename(trip, 0, 0);
        expect(name).toBe("dashcamigo_20260429_192747-192747");
    });

    it("clip across midnight uses full date for end timestamp", () => {
        // 2026-04-29 23:50:00 local + 905 sec → 2026-04-30 00:05:05
        const start = new Date(2026, 3, 29, 23, 50, 0).getTime() / 1000;
        const trip = makeTrip(start);
        const name = clipBasename(trip, 0, 905);
        expect(name).toBe("dashcamigo_20260429_235000-20260430_000505");
    });

    it("clip across month boundary also uses full end timestamp", () => {
        // 2026-04-30 23:59:30 local + 60 sec → 2026-05-01 00:00:30
        const start = new Date(2026, 3, 30, 23, 59, 30).getTime() / 1000;
        const trip = makeTrip(start);
        const name = clipBasename(trip, 0, 60);
        expect(name).toBe("dashcamigo_20260430_235930-20260501_000030");
    });

    it("ignores fractional seconds (whole-second granularity in filename)", () => {
        const start = new Date(2026, 3, 29, 19, 27, 47).getTime() / 1000;
        const trip = makeTrip(start);
        const name = clipBasename(trip, 0.4, 28.7);
        // 28.7 s added as 28700 ms to unix*1000 → new Date truncates to whole seconds → 19:28:15
        expect(name).toMatch(/^dashcamigo_20260429_192747-1928\d{2}$/);
    });
});

// formatTripTitle only reads startUtc/endUtc (plus the i18n date locale); the
// timeline is irrelevant here, so a two-field stub is enough.
function makeTitleTrip(startUtc: number, endUtc: number): Trip {
    return { startUtc, endUtc } as unknown as Trip;
}

const secOf = (d: Date): number => d.getTime() / 1000;

describe("formatTripTitle", () => {
    // Runs under TZ=UTC (see package.json test script) so local getters == UTC.
    const now = new Date(2026, 5, 15, 12, 0, 0); // Mon Jun 15 2026

    it("hides the year for a trip in the current year", () => {
        const title = formatTripTitle(
            makeTitleTrip(secOf(new Date(2026, 3, 29, 18, 26, 0)), secOf(new Date(2026, 3, 29, 18, 42, 0))),
            now,
        );
        expect(title).toContain("→");
        expect(title, "current-year trip must not print the year").not.toMatch(/\b2026\b/);
    });

    it("shows the year when the trip is in a different year than now", () => {
        const title = formatTripTitle(
            makeTitleTrip(secOf(new Date(2024, 3, 29, 18, 26, 0)), secOf(new Date(2024, 3, 29, 18, 42, 0))),
            now,
        );
        expect(title).toMatch(/\b2024\b/);
    });

    it("same-day trip renders one date, overnight renders two", () => {
        const sameDay = formatTripTitle(
            makeTitleTrip(secOf(new Date(2026, 3, 29, 18, 26, 0)), secOf(new Date(2026, 3, 29, 18, 42, 0))),
            now,
        );
        const overnight = formatTripTitle(
            makeTitleTrip(secOf(new Date(2026, 3, 29, 23, 50, 0)), secOf(new Date(2026, 3, 30, 0, 15, 0))),
            now,
        );
        // Same-day form has a comma between the single date and the time range;
        // the overnight form repeats "date time" on both sides of the arrow.
        expect(sameDay).toContain(", ");
        expect(overnight).not.toContain(", ");
        expect(overnight.split("→")).toHaveLength(2);
    });
});

describe("dateBucketLabel", () => {
    // TZ=UTC: local-midnight truncation matches UTC, so the day math is stable.
    const now = new Date(2026, 5, 15, 12, 0, 0); // Mon Jun 15 2026, noon

    it("buckets a timestamp by its day distance from now", () => {
        // Comparing against t() (not a hard-coded string) keeps this locale-agnostic.
        expect(dateBucketLabel(secOf(new Date(2026, 5, 15, 8, 0, 0)), now)).toBe(t("buckets.today"));
        expect(dateBucketLabel(secOf(new Date(2026, 5, 14, 8, 0, 0)), now)).toBe(t("buckets.yesterday"));
        expect(dateBucketLabel(secOf(new Date(2026, 5, 12, 8, 0, 0)), now)).toBe(t("buckets.thisWeek")); // 3d
        expect(dateBucketLabel(secOf(new Date(2026, 5, 1, 8, 0, 0)), now)).toBe(t("buckets.thisMonth")); // 14d
        expect(dateBucketLabel(secOf(new Date(2026, 2, 1, 8, 0, 0)), now)).toBe(t("buckets.earlier")); // >30d
    });

    it("labels a future timestamp explicitly (clock skew / bad mtime guard)", () => {
        expect(dateBucketLabel(secOf(new Date(2026, 5, 20, 8, 0, 0)), now)).toBe(t("buckets.future"));
    });
});

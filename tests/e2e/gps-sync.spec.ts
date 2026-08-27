// GPS/video calibration behavior: one quiet launcher, live per-trip overrides,
// a player-wide default, and the action-camera + manually attached GPX path.

import { readFileSync } from "node:fs";
import path from "node:path";

import {
    DESKTOP,
    MOBILE,
    SAMPLE_70MAI,
    SAMPLE_GOPRO,
    SAMPLE_NOGPS,
    expect,
    gotoApp,
    loadTrip,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

test.describe("GPS synchronization", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    test("player default and a stable per-trip override stay visually explicit", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        const pill = page.locator("#gps-sync-pill");
        await expect(pill).toBeVisible();
        await expect(pill).toHaveText("Sync GPS");
        await expect(pill).not.toHaveClass(/is-shifted/);

        // The map gear is the contextual duplicate entry point; it opens the
        // same dialog instead of growing a second set of calibration controls.
        const modal = page.locator("#gps-sync-modal");
        await page.locator(".mini-map").click();
        await page.locator("#map-settings-toggle").click();
        const mapAction = page.locator("#map-gps-sync-btn");
        await expect(mapAction).toBeVisible();
        await expect(mapAction).toHaveText("Sync GPS");
        await mapAction.click();
        await expect(modal).toBeVisible();
        await page.locator("#gps-sync-close").click();

        // General Map settings supplies the player-wide fallback.
        await page.locator("#settings-btn").click();
        const defaultInput = page.locator("#settings-gps-offset-input");
        await defaultInput.fill("0.5");
        await defaultInput.press("Tab");
        await page.locator("#settings-modal-close").click();
        await expect(pill).toHaveClass(/is-shifted/);
        await expect(pill).toHaveText("GPS +0.5s");
        await page.locator("#map-settings-toggle").click();
        await expect(mapAction).toHaveClass(/is-shifted/);
        await expect(mapAction).toHaveText("GPS +0.5s");
        await page.keyboard.press("Escape");

        // One discrete edit creates a trip override; changing the global value
        // afterwards must leave this trip on its own setting.
        await pill.click();
        await expect(modal).toBeVisible();
        await expect(page.locator("#gps-sync-offset-input")).toHaveValue("0.5");
        await page.locator('[data-gps-delta="1"]').click();
        await expect(page.locator("#gps-sync-offset-input")).toHaveValue("1.5");
        await expect(page.locator("#gps-sync-use-default")).toBeEnabled();
        await page.locator("#gps-sync-close").click();
        await expect(pill).toHaveText("GPS +1.5s");

        await page.locator("#settings-btn").click();
        await defaultInput.fill("2.5");
        await defaultInput.press("Tab");
        await page.locator("#settings-modal-close").click();
        await expect(pill).toHaveText("GPS +1.5s");

        // Reopening the same folder creates fresh File/Trip objects. The stable
        // file identity in localStorage must restore the trip override.
        await page.reload();
        await loadTrip(page, SAMPLE_70MAI);
        await expect(page.locator("#gps-sync-pill")).toHaveText("GPS +1.5s");

        await page.locator("#gps-sync-pill").click();
        await page.locator("#gps-sync-use-default").click();
        await expect(page.locator("#gps-sync-offset-input")).toHaveValue("2.5");
    });

    test("a confirmed loose GPX keeps its timestamp until the user explicitly aligns it", async ({ page }) => {
        await loadTrip(page, SAMPLE_NOGPS);
        await expect(page.locator("#gps-sync-pill")).toBeHidden();

        const videoStart = await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            return state.trips[state.active!.trip]!.timeline.segments[0]!.wallStart;
        });
        const routeStart = videoStart + 14 * 24 * 60 * 60;

        const points = Array.from({ length: 60 }, (_, index) => {
            const time = new Date((routeStart + index) * 1000).toISOString();
            return `<trkpt lat="${(43.2 + index * 0.00001).toFixed(6)}" lon="76.900000"><time>${time}</time><speed>5</speed></trkpt>`;
        }).join("");
        const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points}</trkseg></trk></gpx>`;
        await page.locator("#file-input").setInputFiles({
            name: "dashcam-route.gpx",
            mimeType: "application/gpx+xml",
            buffer: Buffer.from(gpx),
        });

        const assignmentModal = page.locator("#gpx-assignment-modal");
        await expect(assignmentModal).toBeVisible();
        await expect(page.locator(".gpx-assignment-path")).toHaveText("dashcam-route.gpx");
        const assignment = page.locator(".gpx-assignment-select");
        await expect(assignment).toHaveValue("");
        await expect(page.locator("#gpx-assignment-apply")).toBeDisabled();
        await assignment.selectOption({ index: 1 });
        await page.locator("#gpx-assignment-apply").click();
        await expect(assignmentModal).toBeHidden();

        const pill = page.locator("#gps-sync-pill");
        await expect(pill).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#notif-drawer-list")).toContainText("GPX track attached");

        const initial = await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            const trip = state.trips[state.active!.trip]!;
            const candidate = trip.frames[0]!.channels.front!;
            return {
                videoStart: trip.timeline.segments[0]!.wallStart,
                trackStart: candidate.records[0]!.unixSeconds,
                effectiveCount: trip.records.length,
                rawCount: candidate.records.length,
                external: candidate.records.every((record) => record.externalTrack === true),
                userOffset: trip.gpsOffsetSec,
            };
        });
        expect(initial.external, "manual GPX must never become a video clock anchor").toBe(true);
        expect(initial.userOffset).toBe(0);
        expect(initial.trackStart).toBeCloseTo(initial.videoStart + 14 * 24 * 60 * 60, 3);
        expect(initial.effectiveCount, "a mismatched track starts outside the footage").toBe(0);

        await pill.click();
        await page.locator("#gps-sync-align-playhead").click();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const state = window.__dashcamigo.state;
                    return state.trips[state.active!.trip]!.records.length;
                }),
            )
            .toBeGreaterThan(0);

        await page.locator("label:has(#gps-sync-trim-toggle)").click();
        await expect(page.locator("#gps-sync-trim-toggle")).not.toBeChecked();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const state = window.__dashcamigo.state;
                    return state.trips[state.active!.trip]!.records.length;
                }),
            )
            .toBe(initial.rawCount);

        await page.locator('[data-gps-delta="1"]').click();
        const explicitOffset = await page.locator("#gps-sync-offset-input").inputValue();
        expect(Number(explicitOffset)).toBeCloseTo(-14 * 24 * 60 * 60 + 1, 0);
        const shiftedStart = await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            const trip = state.trips[state.active!.trip]!;
            return {
                videoStart: trip.timeline.segments[0]!.wallStart,
                trackStart: trip.records[0]!.unixSeconds,
            };
        });
        expect(shiftedStart.trackStart).toBeCloseTo(shiftedStart.videoStart + 1, 0);
    });

    test("a unique timestamp overlap recommends the matching trip but still waits for Apply", async ({ page }) => {
        const namedStart = Date.UTC(2026, 7, 9, 22, 23, 34) / 1000;
        const points = Array.from({ length: 289 }, (_, index) => -12 * 60 * 60 + index * 5 * 60)
            .map(
                (delta) =>
                    `<trkpt lat="43.2" lon="76.9"><time>${new Date((namedStart + delta) * 1000).toISOString()}</time></trkpt>`,
            )
            .join("");
        await page.locator("#file-input").setInputFiles([
            {
                name: "2026_0809_222334_654A.MOV",
                mimeType: "video/quicktime",
                buffer: readFileSync(path.join(SAMPLE_NOGPS, "clip-no-gps.mp4")),
            },
            {
                name: "matching-route.gpx",
                mimeType: "application/gpx+xml",
                buffer: Buffer.from(
                    `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`,
                ),
            },
        ]);

        const modal = page.locator("#gpx-assignment-modal");
        await expect(modal).toBeVisible();
        const assignment = page.locator(".gpx-assignment-select");
        await expect(assignment).not.toHaveValue("");
        await expect(assignment.locator("option:checked")).toContainText("time matches");
        await expect(page.locator("#gpx-assignment-apply")).toBeEnabled();
        await expect(page.locator("#gps-sync-pill")).toBeHidden();

        await page.locator("#gpx-assignment-apply").click();
        await expect(modal).toBeHidden();
        await page.locator("li.trip:not(.unindexed-note)").first().click();
        await expect(page.locator("#gps-sync-pill")).toBeVisible({ timeout: 30_000 });
    });

    test("multiple loose GPX files wait for an explicit trip assignment", async ({ page }) => {
        await loadTrip(page, SAMPLE_NOGPS);
        const gpx = (lat: number) => {
            const points = Array.from({ length: 3 }, (_, index) => {
                const time = new Date(Date.UTC(2035, 0, 1, 0, 0, index)).toISOString();
                return `<trkpt lat="${(lat + index * 0.00001).toFixed(6)}" lon="76.900000"><time>${time}</time></trkpt>`;
            }).join("");
            return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;
        };

        await page.locator("#file-input").setInputFiles([
            { name: "route-one.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx(43.1)) },
            { name: "route-two.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx(44.2)) },
        ]);

        const modal = page.locator("#gpx-assignment-modal");
        await expect(modal).toBeVisible();
        await expect(page.locator(".gpx-assignment-path")).toHaveText(["route-one.gpx", "route-two.gpx"]);
        const selects = page.locator(".gpx-assignment-select");
        await expect(selects).toHaveCount(2);
        await expect(page.locator("#gpx-assignment-apply")).toBeDisabled();

        await selects.nth(0).selectOption({ index: 1 });
        const selectedTrip = await selects.nth(0).inputValue();
        await expect(selects.nth(1).locator(`option[value="${selectedTrip}"]`)).toHaveAttribute("disabled", "");
        await expect(page.locator("#gpx-assignment-apply")).toBeEnabled();
        await page.locator("#gpx-assignment-apply").click();

        await expect(modal).toBeHidden();
        await expect(page.locator("#gps-sync-pill")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#notif-drawer-list")).toContainText("GPX track attached");
        const records = await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            return state.trips[state.active!.trip]!.frames[0]!.channels.front!.records.map((record) => ({
                lat: record.lat,
                external: record.externalTrack,
            }));
        });
        expect(records).toHaveLength(3);
        expect(records.every((record) => record.external === true)).toBe(true);
        expect(records.every((record) => record.lat < 44)).toBe(true);
    });

    test("skipping a single loose GPX leaves the loaded video unchanged", async ({ page }) => {
        const point = (name: string, lat: number) => ({
            name,
            mimeType: "application/gpx+xml",
            buffer: Buffer.from(
                `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="${lat}" lon="76.9"><time>2035-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>`,
            ),
        });
        const video = {
            name: "clip-no-gps.mp4",
            mimeType: "video/mp4",
            buffer: readFileSync(path.join(SAMPLE_NOGPS, "clip-no-gps.mp4")),
        };
        await page.locator("#file-input").setInputFiles([video, point("route.gpx", 43.1)]);

        const modal = page.locator("#gpx-assignment-modal");
        await expect(modal).toBeVisible();
        await page.locator("#gpx-assignment-skip").click();
        await expect(modal).toBeHidden();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#gps-sync-pill")).toBeHidden();
        expect(
            await page.evaluate(() => {
                const state = window.__dashcamigo.state;
                return state.trips[0]!.frames[0]!.channels.front!.records.length;
            }),
        ).toBe(0);
    });

    test("a loose GPX cannot be merged into a trip that already has GPS", async ({ page }) => {
        await loadTrip(page, SAMPLE_GOPRO);
        const findGpsTrip = () =>
            page.evaluate(() =>
                window.__dashcamigo.state.trips.findIndex((trip) =>
                    trip.frames.some((frame) =>
                        Object.values(frame.channels).some((candidate) =>
                            candidate?.records.some(
                                (record) => Number.isFinite(record.lat) && Number.isFinite(record.lon),
                            ),
                        ),
                    ),
                ),
            );
        // loadTrip waits for playable video, while embedded GPS extraction may
        // still commit afterward. Wait on the state this test actually needs.
        await expect.poll(findGpsTrip, { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
        const gpsTrip = await findGpsTrip();
        await page.locator(`li.trip[data-trip-index="${gpsTrip}"]`).click();
        await expect(page.locator("#gps-sync-pill")).toBeVisible();
        const gpx = (name: string) => ({
            name,
            mimeType: "application/gpx+xml",
            buffer: Buffer.from(
                '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="43.1" lon="76.9"><time>2035-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>',
            ),
        });
        await page.locator("#file-input").setInputFiles([gpx("route-one.gpx"), gpx("route-two.gpx")]);

        const modal = page.locator("#gpx-assignment-modal");
        await expect(modal).toBeVisible();
        const protectedTargets = page.locator('.gpx-assignment-select option:has-text("already has GPS")');
        await expect(protectedTargets).not.toHaveCount(0);
        for (let index = 0; index < (await protectedTargets.count()); index++) {
            await expect(protectedTargets.nth(index)).toHaveAttribute("disabled", "");
        }
        await page.locator("#gpx-assignment-skip").click();
        await expect(modal).toBeHidden();
    });

    test("an exact-name sidecar wins before a loose GPX is offered", async ({ page }) => {
        await loadTrip(page, SAMPLE_NOGPS);
        const gpx = (name: string, lat: number) => ({
            name,
            mimeType: "application/gpx+xml",
            buffer: Buffer.from(
                `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="${lat}" lon="76.9"><time>2035-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>`,
            ),
        });
        await page.locator("#file-input").setInputFiles([gpx("clip-no-gps.gpx", 43.1), gpx("another-route.gpx", 44.2)]);

        const modal = page.locator("#gpx-assignment-modal");
        await expect(modal).toBeVisible();
        await expect(page.locator(".gpx-assignment-path")).toHaveText("another-route.gpx");
        const target = page.locator('.gpx-assignment-select option:not([value=""])');
        await expect(target).toHaveCount(1);
        await expect(target).toHaveAttribute("disabled", "");
        await expect(target).toContainText("already has GPS");
        await expect(page.locator("#gpx-assignment-apply")).toBeDisabled();
        await page.locator("#gpx-assignment-skip").click();

        await expect(page.locator("#gps-sync-pill")).toBeVisible();
        const latitudes = await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            return state.trips[state.active!.trip]!.frames[0]!.channels.front!.records.map((record) => record.lat);
        });
        expect(latitudes).toEqual([43.1]);
    });

    test("the compact phone launcher exposes the same live per-trip control", async ({ page }) => {
        await page.setViewportSize(MOBILE);
        await loadTrip(page, SAMPLE_70MAI);

        const mobilePill = page.locator("#gps-sync-pill-mobile");
        await expect(mobilePill).toBeVisible();
        await expect(page.locator("#gps-sync-pill")).toBeHidden();
        await expect(mobilePill).toHaveAccessibleName("Sync GPS");

        await mobilePill.click();
        const modal = page.locator("#gps-sync-modal");
        await expect(modal).toBeVisible();
        await expect(page.locator(".gps-sync-card")).toBeInViewport();
        await page.locator('[data-gps-delta="1"]').click();
        await page.locator("#gps-sync-close").click();

        await expect(mobilePill).toHaveClass(/is-shifted/);
        await expect(mobilePill).toHaveText("+1s");
        await expect(mobilePill).toHaveAccessibleName("GPS +1s");
    });
});

import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import { loadTrip, openExport, pausePlayback, SAMPLE_NOGPS } from "./_fixtures.js";

/** The same import/readout/export contract on hosted and real file origins. */
export async function verifyGpxSpeed(page: Page, mode: "sidecar" | "manual", estimatedLabel: string): Promise<void> {
    await loadTrip(page, SAMPLE_NOGPS);
    await pausePlayback(page);
    const start = await page.evaluate(() => {
        const state = window.__everydashcam.state;
        return state.trips[state.active!.trip]!.timeline.segments[0]!.wallStart;
    });
    const point = (index: number, field = "") =>
        `<trkpt lat="${50 + index * 0.0001}" lon="30"><time>${new Date((start + index) * 1000).toISOString()}</time>${field}</trkpt>`;
    const gpx = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${point(0, "<speed>0</speed>")}${point(1)}</trkseg><trkseg>${point(2)}</trkseg></trk></gpx>`;
    await page.locator("#file-input").setInputFiles({
        name: mode === "sidecar" ? "clip-no-gps.gpx" : "walking-route.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(gpx),
    });
    if (mode === "manual") {
        await expect(page.locator("#gpx-assignment-modal")).toBeVisible();
        await page.locator(".gpx-assignment-select").selectOption({ index: 1 });
        await page.locator("#gpx-assignment-apply").click();
        await expect(page.locator("#gpx-assignment-modal")).toBeHidden();
    }
    await expect
        .poll(() =>
            page.evaluate(() => {
                const state = window.__everydashcam.state;
                return state.trips[state.active!.trip]!.records.map((r) => r.speedSource);
            }),
        )
        .toEqual(["measured", "estimated", "unavailable"]);
    await page.locator("#player").evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 1;
    });
    await expect(page.locator("#pm-speed")).toHaveText("≈40.0");
    await expect(page.locator("#pm-bar-speed")).toHaveText("≈40.0");
    await expect(page.locator("#pm-speed")).toHaveAttribute("title", estimatedLabel);
    await page.screenshot({ path: test.info().outputPath("estimated-speed.png") });
    await page.locator("#pm-speed-toggle").click();
    await expect(page.locator("#pm-speed")).toHaveText("≈24.9");
    await page.locator("#pm-speed-toggle").click();
    await expect(page.locator("#pm-speed")).toHaveText("≈40.0");
    const chart = await page.evaluate(() => {
        const state = window.__everydashcam.state;
        return {
            speeds: state.chart!.data.datasets[0]!.data,
            spanGaps: Reflect.get(state.chart!.data.datasets[0]!, "spanGaps"),
            events: state.trips[state.active!.trip]!.inferredSegments,
        };
    });
    expect(chart.speeds).toHaveLength(4);
    expect(chart.speeds[1]).toMatchObject({ y: expect.closeTo(40.03, 1) });
    expect(chart.speeds[2]).toMatchObject({ y: Number.NaN });
    expect(chart.speeds[3]).toMatchObject({ y: Number.NaN });
    expect(chart.spanGaps).toBe(false);
    expect(chart.events).toEqual([]);
    await page.locator("#player").evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 2;
    });
    await expect(page.locator("#pm-speed")).toHaveText("-");
    await expect(page.locator("#pm-coords")).not.toHaveText("-");
    await page.locator("#player").evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 0;
    });
    await expect(page.locator("#pm-speed")).toHaveText("0.0");
    await expect(page.locator("#pm-speed")).toHaveAttribute("title", "");
    await openExport(page);
    await page.locator('.export-panel__seg-btn[data-mode="gpx"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-panel-save-btn").click();
    const download = await downloadPromise;
    const exported = await readFile(await download.path(), "utf8");
    expect(exported).toContain('source="estimated"');
    expect(exported).toContain('<dc:speed source="unavailable"/>');
    expect(exported).toContain('<dc:speed source="measured">0.00</dc:speed>');
    expect(exported.match(/<trkseg>/g)).toHaveLength(2);
}

export async function verifyRobustGpxSpeed(page: Page): Promise<void> {
    await loadTrip(page, SAMPLE_NOGPS);
    await pausePlayback(page);
    const start = await page.evaluate(() => {
        const state = window.__everydashcam.state;
        return state.trips[state.active!.trip]!.timeline.segments[0]!.wallStart;
    });
    const metersPerDegree = (6_371_000 * Math.PI) / 180;
    const points = Array.from({ length: 12 }, (_, i) => {
        const time = i / 4;
        const fixTime = time + (i === 5 ? 0.125 : i === 9 ? -0.125 : 0);
        return `<trkpt lat="${50 + (fixTime * 30) / metersPerDegree}" lon="30"><time>${new Date((start + time) * 1000).toISOString()}</time></trkpt>`;
    });
    await page.locator("#file-input").setInputFiles({
        name: "clip-no-gps.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(`<gpx><trk><trkseg>${points.join("")}</trkseg></trk></gpx>`),
    });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const state = window.__everydashcam.state;
                return state.trips[state.active!.trip]!.records.length;
            }),
        )
        .toBe(12);
    await page.locator("#player").evaluate((element) => {
        (element as HTMLVideoElement).currentTime = 1.25;
    });
    await expect(page.locator("#pm-speed")).toHaveText("≈108.0");
    await expect(page.locator("#pm-bar-speed")).toHaveText("≈108.0");
    const telemetry = await page.evaluate(() => {
        const state = window.__everydashcam.state;
        const trip = state.trips[state.active!.trip]!;
        return {
            readings: trip.records.map((r) => ({ speed: r.speedMs, source: r.speedSource })),
            chart: state.chart!.data.datasets[0]!.data,
            events: trip.inferredSegments,
        };
    });
    for (const reading of telemetry.readings) {
        expect(reading.source).toBe("estimated");
        expect(reading.speed).toBeCloseTo(30, 3);
    }
    expect(telemetry.chart).toHaveLength(12);
    for (const entry of telemetry.chart) expect(entry).toMatchObject({ y: expect.closeTo(108, 2) });
    expect(telemetry.events).toEqual([]);

    await openExport(page);
    await page.locator('.export-panel__seg-btn[data-mode="gpx"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-panel-save-btn").click();
    const exported = await readFile(await (await downloadPromise).path(), "utf8");
    expect(exported.match(/<dc:speed source="estimated">30\.00<\/dc:speed>/g)).toHaveLength(12);
}

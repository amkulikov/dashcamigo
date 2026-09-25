import { expect, test } from "@playwright/test";

import { loadTrip, pausePlayback, presetLocalStorage, SAMPLE_70MAI } from "../e2e/_fixtures.js";
import { openPortable } from "./_fixtures.js";

test("retains browser notes and theme after a browser restart and a newly dated filename", async ({
    playwright,
}, info) => {
    const profile = info.outputPath("profile");
    const errors: string[] = [];
    for (const restart of [false, true]) {
        const context = await playwright.chromium.launchPersistentContext(profile, {
            channel: process.env.PW_CHANNEL || "chromium",
            headless: true,
            viewport: { width: 1440, height: 960 },
            serviceWorkers: "block",
        });
        try {
            await context.setOffline(true);
            const page = context.pages()[0] ?? (await context.newPage());
            page.on("pageerror", (error) => errors.push(error.message));
            await page.route(/^https?:/, (route) => route.abort());
            if (!restart) await presetLocalStorage(page);
            await openPortable(
                page,
                info.outputPath(restart ? "new-card" : "old-card"),
                "en",
                restart ? "dashcamigo-2026-09-25-en.html" : "dashcamigo-2026-09-24-en.html",
            );
            await loadTrip(page, SAMPLE_70MAI);
            await pausePlayback(page);
            const trip = page.locator("li.trip:not(.unindexed-note)").first();
            await trip.locator(".trip-edit").click();
            if (restart) {
                await expect(page.locator("#trip-meta-name")).toHaveValue("Restart journey");
                await expect(page.locator("#trip-meta-note")).toHaveValue("Survives closing the browser");
                await expect(page.locator("html")).toHaveClass(/dc-light/);
                await expect(page.locator("#settings-map-provider-select")).toHaveValue("osm-vector");
            } else {
                await page.locator("#trip-meta-name").fill("Restart journey");
                await page.locator("#trip-meta-note").fill("Survives closing the browser");
                await page.locator("#trip-meta-save").click();
                await page
                    .locator("#notes-storage-modal")
                    .getByRole("button", { name: "Only in this browser", exact: true })
                    .click();
                await page.locator('.theme-toggle-btn[data-theme="light"]').click();
                await page.locator("#settings-btn").click();
                await page.locator("#settings-map-provider-select").selectOption("osm-vector");
                await page.locator("#settings-modal-header-close").click();
                await expect
                    .poll(() =>
                        page.evaluate(
                            () =>
                                new Promise<boolean>((resolve, reject) => {
                                    const request = indexedDB.open("dashcamigo");
                                    request.onerror = () => reject(request.error);
                                    request.onsuccess = () => {
                                        const database = request.result;
                                        const read = database
                                            .transaction("annotations")
                                            .objectStore("annotations")
                                            .getAll();
                                        read.onerror = () => {
                                            database.close();
                                            reject(read.error);
                                        };
                                        read.onsuccess = () => {
                                            database.close();
                                            resolve(
                                                read.result.some(
                                                    (record: { name?: string }) => record.name === "Restart journey",
                                                ),
                                            );
                                        };
                                    };
                                }),
                        ),
                    )
                    .toBe(true);
            }
        } finally {
            await context.close();
        }
    }
    expect(errors).toEqual([]);
});

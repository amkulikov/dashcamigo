import { rmSync } from "node:fs";
import { ddpaiFixtureFolder } from "../e2e/_ddpai-gps.js";
import { loadTrip, presetLocalStorage } from "../e2e/_fixtures.js";
import { expect } from "@playwright/test";
import { openPortable, test } from "./_fixtures.js";

for (const withGps of [false, true]) {
    test(`DDPAI ${withGps ? "archive GPS" : "storage hint"} works from a file URL`, async ({ page }, info) => {
        const directory = ddpaiFixtureFolder(withGps);
        try {
            await presetLocalStorage(page);
            await openPortable(page, info.outputPath("ddpai"));
            await loadTrip(page, directory);
            await expect(page.locator("#trip-analysis-status")).toBeHidden();
            if (withGps) {
                await expect(page.locator(".player-no-gps")).toBeHidden();
                await expect(page.locator("#player-chart-canvas")).toBeVisible();
                await expect(page.locator(".dc-toast").filter({ hasText: "203gps" })).toHaveCount(0);
            } else {
                await expect(page.locator(".dc-toast").filter({ hasText: "203gps" })).toBeVisible();
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

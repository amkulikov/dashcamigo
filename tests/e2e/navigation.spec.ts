// Navigation / shell / i18n flows that need no trip loaded: landing copy per
// locale, vendor pages, root redirect, the language switcher, and the settings
// & feedback modals. All assertion-driven; the console/pageerror sentinel in
// the fixture turns any uncaught error on these surfaces into a failure.

import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, gotoApp, loadTrip, presetLocalStorage, shot, test } from "./_fixtures.js";
import { DESKTOP } from "./_fixtures.js";

test.describe("navigation & shell", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
    });

    test("/en/ landing renders English hero copy", async ({ page }) => {
        await gotoApp(page, "en");
        await expect(page.locator("#landing")).toBeVisible();
        // h1.hl resolves to "...map, speed, events." in the EN dictionary - a
        // raw data-i18n key here would mean the runtime swap failed.
        await expect(page.locator("#landing h1")).toContainText(/map/i);
        await shot(page, "nav-01-landing-en");
    });

    test("landing topbar becomes elevated after scrolling", async ({ page }) => {
        await gotoApp(page, "en");
        const landing = page.locator("#landing");
        const topbar = page.locator(".topbar");

        await expect(
            topbar.locator(".dc-mark"),
            "the brand remains visible on the uninterrupted surface",
        ).toBeVisible();
        const landingBackground = await landing.evaluate((element) => getComputedStyle(element).backgroundColor);
        await expect
            .poll(() => topbar.evaluate((element) => getComputedStyle(element).backgroundColor), {
                message: "topbar shares the untouched landing background",
            })
            .toBe(landingBackground);

        await landing.evaluate((element) => {
            element.scrollTop = 32;
        });
        await expect(page.locator("body")).toHaveClass(/landing-scrolled/);
        await expect
            .poll(() => topbar.evaluate((element) => getComputedStyle(element).backgroundColor), {
                message: "scrolled topbar restores its elevated surface",
            })
            .not.toBe(landingBackground);
    });

    test("/ru/ landing renders Cyrillic hero copy", async ({ page }) => {
        await gotoApp(page, "ru");
        await expect(page.locator("#landing")).toBeVisible();
        await expect(page.locator("#landing h1")).toContainText(/[а-яё]/i);
        await shot(page, "nav-02-landing-ru");
    });

    test("vendor page /en/cameras/70mai/ is 200 with a self-canonical", async ({ page }) => {
        const resp = await page.goto("/en/cameras/70mai/");
        expect(resp?.status(), "vendor page must be 200").toBe(200);
        const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
        expect(canonical).toContain("/en/cameras/70mai/");
        await shot(page, "nav-03-vendor-70mai");
    });

    test("root / redirects to a locale home", async ({ page }) => {
        await page.goto("/");
        await page.waitForURL(/\/(en|ru|de|es|fr|pt|zh|ja|ko|pl)\/$/, { timeout: 5000 });
        expect(page.url()).toMatch(/\/[a-z]{2}\/$/);
    });

    test("language switcher swaps the page to Russian", async ({ page }) => {
        await gotoApp(page, "en");
        await page.locator("#lang-toggle").click();
        await expect(page.locator("#lang-menu")).toBeVisible();
        const ruItem = page.locator('#lang-menu [data-lang="ru"]').first();
        await expect(ruItem, "the menu must offer Russian").toBeVisible();
        await ruItem.click();
        await page.waitForURL(/\/ru\//, { timeout: 5000 });
        await expect(page.locator("#landing h1")).toContainText(/[а-яё]/i);
        await shot(page, "nav-04-lang-switched");
    });

    test("settings modal exposes units + version", async ({ page }) => {
        await gotoApp(page, "en");
        await page.locator("#settings-btn").click();
        await expect(page.locator("#settings-modal")).toBeVisible();
        await expect(page.locator("#settings-units-select")).toBeVisible();
        await expect(page.locator("#settings-notes-export-btn")).toBeVisible();
        await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
        await expect(page.locator("#settings-version-value")).toBeVisible();
        await shot(page, "nav-05-settings-modal");
    });

    test("settings modal reports cache usage and clears it", async ({ page }) => {
        await gotoApp(page, "en");
        // A populated cache is the whole point: an empty profile would show the
        // same "0 clips" readout before and after the clear, proving nothing.
        await loadTrip(page);
        // The write-back is fire-and-forget off the ingest path - wait for it
        // to land before the modal snapshots the stats.
        await expect
            .poll(() => storedIndexCacheEntryCount(page), { message: "ingest must persist index-cache entries" })
            .toBeGreaterThan(0);

        await page.locator("#settings-btn").click();
        await expect(page.locator("#settings-modal")).toBeVisible();
        const usage = page.locator("#settings-cache-usage-value");
        await expect(usage, "the readout reflects the populated cache").toContainText(/· [1-9]\d* clips?/);
        await expect(page.locator("#settings-cache-limit-input")).toHaveValue("128");

        const clearBtn = page.locator("#settings-cache-clear-btn");
        await clearBtn.click();
        await expect(usage, "the readout drops to empty after the wipe").toContainText(/· 0 clips/);
        await expect(clearBtn, "re-enabled once the wipe settles").toBeEnabled();
        expect(await storedIndexCacheEntryCount(page), "the store itself is empty").toBe(0);
    });

    test("feedback modal opens and cancels", async ({ page }) => {
        await gotoApp(page, "en");
        const fbBtn = page.locator("#feedback-btn");
        await expect(fbBtn, "feedback entry point must be present on desktop").toBeVisible();
        await fbBtn.click();
        await expect(page.locator("#feedback-modal")).toBeVisible();
        await page.locator("#feedback-cancel").click();
        await expect(page.locator("#feedback-modal")).toBeHidden();
    });

    test("feedback wizard: recordings step, download the .txt report, then a pre-filled mailto", async ({ page }) => {
        // No Web Share anywhere - one flow on every platform: recordings choice ->
        // download the single .txt report -> email it. window.open is stubbed to
        // capture the mailto and return a truthy window so feedback.ts does not
        // fall back to location.href.
        await page.addInitScript(() => {
            const w = window as unknown as { __mailto?: string };
            window.open = (url?: string | URL) => {
                if (typeof url === "string" && url.startsWith("mailto:")) {
                    w.__mailto = url;
                    return { closed: false } as Window;
                }
                return null;
            };
        });
        await gotoApp(page, "en");
        await page.locator("#feedback-btn").click();
        // Step 1: the recordings choice is shown first, the report step is hidden.
        await expect(page.locator("#feedback-step-recordings")).toBeVisible();
        await expect(page.locator("#feedback-step-report")).toBeHidden();
        // No card loaded here -> the "open my card first" callout is offered.
        await expect(page.locator("#feedback-noingest")).toBeVisible();
        await shot(page, "nav-06-feedback-recordings");

        // "I've got a link" advances to the report step (and later prompts for the link).
        await page.locator("#feedback-recordings-yes").click();
        await expect(page.locator("#feedback-step-report")).toBeVisible();
        await expect(page.locator("#feedback-primary")).toBeVisible();

        const downloadPromise = page.waitForEvent("download");
        await page.locator("#feedback-primary").click();
        const download = await downloadPromise;
        // Single plain-text report - no zip, no JSON.
        expect(download.suggestedFilename()).toMatch(/^dashcamigo-report-.+\.txt$/);
        const reportPath = await download.path();
        const report = readFileSync(reportPath, "utf8");
        expect(report.startsWith("dashcamigo — technical details"), "report leads with the send-to header").toBe(true);
        expect(report).toContain("== environment ==");

        await expect(page.locator("#feedback-post-download"), "hand-off must be shown").toBeVisible();
        await expect(page.locator("#feedback-post-download-step1")).toContainText(download.suggestedFilename());
        await shot(page, "nav-07-feedback-handoff");

        // The hand-off's "Open email" opens a pre-filled mailto to feedback@.
        await page.locator("#feedback-post-download-mail").click();
        const mailto = await page.evaluate(() => (window as unknown as { __mailto?: string }).__mailto);
        expect(mailto, "a mailto: must have been opened").toBeTruthy();
        expect(mailto).toContain("mailto:feedback@dashcamigo.app");
        const decoded = decodeURIComponent(mailto ?? "");
        expect(decoded).toContain("[dashcamigo]");
        // The "I've got a link" path drops a recordings-link placeholder into the body.
        expect(decoded).toContain("Recordings link");
    });

    test("no-recordings modal routes into the feedback form", async ({ page }) => {
        await gotoApp(page, "en");
        // The modal only appears after a failed ingest; unhide it directly to
        // exercise the .feedback-link routing wired in feedback.ts.
        await page.evaluate(() => document.getElementById("no-recordings-modal")?.removeAttribute("hidden"));
        await expect(page.locator("#no-recordings-modal")).toBeVisible();
        await page.locator("#no-recordings-help").click();
        // The help CTA closes this dialog and opens the feedback wizard at step 1.
        await expect(page.locator("#feedback-modal")).toBeVisible();
        await expect(page.locator("#no-recordings-modal")).toBeHidden();
        await expect(page.locator("#feedback-step-recordings")).toBeVisible();
    });

    // Standalone "help add my camera" page (public/add-my-camera.html). Tested at
    // the .html path: the extension-less /add-my-camera is a CF Pages redirect,
    // which the local vite preview does not emulate. Switcher is in-page JS.
    test("/add-my-camera help page renders and switches language", async ({ page }) => {
        const resp = await page.goto("/add-my-camera.html");
        expect(resp?.status(), "help page must be 200").toBe(200);
        await expect(page.locator('article[data-lang="en"] h1')).toContainText(/add your dashcam/i);
        await page.locator('.lang-switcher button[data-set-lang="de"]').click();
        await expect(page.locator('article[data-lang="de"]')).toBeVisible();
        await expect(page.locator('article[data-lang="en"]')).toBeHidden();
        await expect(page.locator('article[data-lang="de"] h1')).toContainText(/Dashcam/);
        await shot(page, "nav-08-add-camera-page");
    });
});

/** Entry count of the index-cache store, read straight out of IndexedDB. */
async function storedIndexCacheEntryCount(page: Page): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve, reject) => {
                const request = indexedDB.open("dashcamigo");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const count = db.transaction("indexCache").objectStore("indexCache").count();
                    count.onerror = () => reject(count.error);
                    count.onsuccess = () => {
                        resolve(count.result);
                        db.close();
                    };
                };
            }),
    );
}

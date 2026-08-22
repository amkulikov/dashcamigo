// Project-support surfaces: the post-use prompt counts meaningful recording
// loads, stays behind onboarding, and observes its monthly cooldown. Copy/FAQ
// wording is covered by dictionary + JSON-LD parity tests; this file locks the
// live timing.

import type { Page } from "@playwright/test";

import {
    DESKTOP,
    MOBILE,
    SAMPLE_70MAI,
    SAMPLE_GOPRO,
    SAMPLE_MKV,
    SAMPLE_NOGPS,
    clearOnboarding,
    expect,
    gotoApp,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

const SUCCESSFUL_LOADS = "dashcamigo:support:successful-loads";
const LAST_SHOWN_AT = "dashcamigo:support:last-shown-at";
const ACTION_TAKEN = "dashcamigo:support:action-taken";
const MONTH_AND_A_DAY_MS = 31 * 24 * 60 * 60 * 1000;

async function armIngestCounter(page: Page): Promise<void> {
    await page.evaluate(() => {
        const target = window as typeof window & { __supportIngestDoneCount?: number };
        target.__supportIngestDoneCount = 0;
        addEventListener("dashcamigo:ingest-done", () => {
            target.__supportIngestDoneCount = (target.__supportIngestDoneCount ?? 0) + 1;
        });
    });
}

async function resetSupportState(page: Page, successfulLoads = 0): Promise<void> {
    await page.evaluate(
        ({ successfulLoadsKey, lastShownAtKey, actionTakenKey, successfulLoads }) => {
            localStorage.setItem(successfulLoadsKey, String(successfulLoads));
            localStorage.removeItem(lastShownAtKey);
            localStorage.removeItem(actionTakenKey);
        },
        {
            successfulLoadsKey: SUCCESSFUL_LOADS,
            lastShownAtKey: LAST_SHOWN_AT,
            actionTakenKey: ACTION_TAKEN,
            successfulLoads,
        },
    );
}

async function loadAndWait(page: Page, directory: string): Promise<void> {
    const before = await page.evaluate(
        () => (window as typeof window & { __supportIngestDoneCount?: number }).__supportIngestDoneCount ?? 0,
    );
    await page.locator("#folder-input").setInputFiles(directory);
    await expect
        .poll(
            () =>
                page.evaluate(
                    () =>
                        (window as typeof window & { __supportIngestDoneCount?: number }).__supportIngestDoneCount ?? 0,
                ),
            { timeout: 30_000 },
        )
        .toBe(before + 1);
}

test.describe("project support prompt", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
    });

    test("counts only new recordings, defers for a month, then offers again", async ({ page }) => {
        await gotoApp(page, "en");
        await resetSupportState(page);
        await armIngestCounter(page);

        await loadAndWait(page, SAMPLE_70MAI);
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), SUCCESSFUL_LOADS)).toBe("1");
        await expect(page.locator("#support-banner")).toBeHidden();

        // Selecting the same card again is a duplicate-only pass. It completes
        // normally but must not move the support threshold.
        await loadAndWait(page, SAMPLE_70MAI);
        expect(await page.evaluate((key) => localStorage.getItem(key), SUCCESSFUL_LOADS)).toBe("1");
        await expect(page.locator("#support-banner")).toBeHidden();

        await loadAndWait(page, SAMPLE_GOPRO);
        const banner = page.locator("#support-banner");
        await expect(banner).toBeVisible();
        await expect(page.locator("#support-banner-title")).toHaveText("Did dashcamigo help?");
        await expect(page.locator("#support-banner-body")).toContainText("We don't need donations");
        await expect(page.locator("#support-banner-github")).toHaveAttribute(
            "href",
            "https://github.com/amkulikov/dashcamigo",
        );
        await expect(page.locator("#support-banner-copy")).toHaveText("Copy link");
        await expect(page.locator("#support-banner-later")).toHaveText("Maybe later");
        const firstShownAt = Number(await page.evaluate((key) => localStorage.getItem(key), LAST_SHOWN_AT));
        expect(firstShownAt).toBeGreaterThan(Date.now() - 10_000);
        expect(await page.evaluate((key) => localStorage.getItem(key), ACTION_TAKEN)).toBeNull();

        await page.locator("#support-banner-later").click();
        await expect(banner).toBeHidden();

        // Another useful load during the cooldown does not immediately nag.
        await loadAndWait(page, SAMPLE_NOGPS);
        await expect(banner).toBeHidden();

        // Once the cooldown has elapsed, a later successful load may surface
        // the prompt again. It never appears merely because the page was open.
        await page.evaluate(({ key, elapsed }) => localStorage.setItem(key, String(Date.now() - elapsed)), {
            key: LAST_SHOWN_AT,
            elapsed: MONTH_AND_A_DAY_MS,
        });
        await loadAndWait(page, SAMPLE_MKV);
        await expect(banner).toBeVisible();
        const secondShownAt = Number(await page.evaluate((key) => localStorage.getItem(key), LAST_SHOWN_AT));
        expect(secondShownAt).toBeGreaterThan(firstShownAt);
    });

    test("waits for unresolved onboarding and does not chain itself onto its dismissal", async ({ page }) => {
        await clearOnboarding(page, ["player"]);
        await gotoApp(page, "en");
        await resetSupportState(page);
        await armIngestCounter(page);

        await loadAndWait(page, SAMPLE_70MAI);
        await loadAndWait(page, SAMPLE_GOPRO);
        expect(await page.evaluate((key) => localStorage.getItem(key), SUCCESSFUL_LOADS)).toBe("2");
        await expect(page.locator("#support-banner")).toBeHidden();

        // Resolve the player tour. The support prompt must stay away at this
        // seam; it may try again only after another successful recording load.
        await page.locator("li.trip:not(.unindexed-note)").first().click();
        await expect(page.locator(".dc-onb")).toBeVisible({ timeout: 5_000 });
        await page.locator(".dc-onb__skip").click();
        await expect(page.locator(".dc-onb")).toHaveCount(0);
        await expect(page.locator("#support-banner")).toBeHidden();

        await loadAndWait(page, SAMPLE_NOGPS);
        await expect(page.locator("#support-banner")).toBeVisible();
    });

    test("feedback opens with a thank-you before asking for recordings", async ({ page }) => {
        await gotoApp(page, "en");
        await page.locator("#feedback-btn").click();

        await expect(page.locator("#feedback-modal")).toBeVisible();
        await expect(page.locator(".feedback-thanks")).toHaveText(
            "Thanks for taking the time to write — it really helps make dashcamigo better.",
        );
        const order = await page
            .locator("#feedback-step-recordings")
            .evaluate((step) => Array.from(step.children).map((child) => child.className));
        expect(order[0]).toContain("feedback-thanks");
    });

    test("fits the Russian actions on a light-theme mobile viewport", async ({ page }) => {
        await page.setViewportSize(MOBILE);
        await gotoApp(page, "ru");
        await resetSupportState(page, 1);
        // The test browser speaks English, so /ru/ correctly surfaces the
        // language suggestion. It has priority over this nudge; dismiss it
        // before exercising the support banner itself.
        await page.locator(".lang-banner-dismiss").click();
        await page.locator('.theme-toggle-btn[data-theme="light"]').click();
        await page.evaluate(() => {
            const target = window as typeof window & { __supportCopiedUrl?: string };
            Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: {
                    writeText: (text: string) => {
                        target.__supportCopiedUrl = text;
                        return Promise.resolve();
                    },
                },
            });
        });
        await armIngestCounter(page);
        await loadAndWait(page, SAMPLE_GOPRO);

        const banner = page.locator("#support-banner");
        await expect(banner).toBeVisible();
        await expect(page.locator("html")).toHaveClass(/dc-light/);
        await expect(page.locator("#support-banner-title")).toHaveText("dashcamigo пригодился?");
        await expect(page.locator("#support-banner-github")).toHaveText("Звезда на GitHub");
        await expect(page.locator("#support-banner-copy")).toHaveText("Скопировать ссылку");
        await expect(page.locator("#support-banner-later")).toHaveText("В другой раз");

        const layout = await banner.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const actions = Array.from(element.querySelectorAll<HTMLElement>(".support-banner-actions .dc-btn")).map(
                (button) => {
                    const box = button.getBoundingClientRect();
                    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
                },
            );
            return {
                viewport: { width: innerWidth, height: innerHeight },
                banner: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                overflowsHorizontally: element.scrollWidth > element.clientWidth,
                actions,
            };
        });
        expect(layout.banner.left).toBeGreaterThanOrEqual(0);
        expect(layout.banner.right).toBeLessThanOrEqual(layout.viewport.width);
        expect(layout.banner.top).toBeGreaterThanOrEqual(0);
        expect(layout.banner.bottom).toBeLessThanOrEqual(layout.viewport.height);
        expect(layout.overflowsHorizontally).toBe(false);
        expect(layout.actions).toHaveLength(3);
        for (const action of layout.actions) {
            expect(action.left).toBeGreaterThanOrEqual(layout.banner.left);
            expect(action.right).toBeLessThanOrEqual(layout.banner.right);
        }
        for (let i = 0; i < layout.actions.length; i++) {
            for (let j = i + 1; j < layout.actions.length; j++) {
                const first = layout.actions[i];
                const second = layout.actions[j];
                expect(first).toBeDefined();
                expect(second).toBeDefined();
                const overlap =
                    first !== undefined &&
                    second !== undefined &&
                    first.left < second.right &&
                    first.right > second.left &&
                    first.top < second.bottom &&
                    first.bottom > second.top;
                expect(overlap).toBe(false);
            }
        }

        await page.locator("#support-banner-copy").click();
        await expect(page.locator("#support-banner-copy")).toHaveText("Ссылка скопирована");
        expect(
            await page.evaluate(
                () => (window as typeof window & { __supportCopiedUrl?: string }).__supportCopiedUrl ?? null,
            ),
        ).toBe("https://dashcamigo.app/ru/");
        expect(await page.evaluate((key) => localStorage.getItem(key), ACTION_TAKEN)).toBe("1");
        await expect(banner).toBeHidden({ timeout: 3_000 });

        // Sharing is a completed action: even an expired display timestamp and
        // another useful load must not revive the prompt.
        await page.evaluate(({ key, elapsed }) => localStorage.setItem(key, String(Date.now() - elapsed)), {
            key: LAST_SHOWN_AT,
            elapsed: MONTH_AND_A_DAY_MS,
        });
        await loadAndWait(page, SAMPLE_NOGPS);
        await expect(banner).toBeHidden();
    });
});

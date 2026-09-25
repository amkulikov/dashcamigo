import { readFile } from "node:fs/promises";
import { type Page, expect } from "@playwright/test";

import { PORTABLE_UPDATE_URL } from "../../src/portable/manifest.mjs";
import { loadTrip, pausePlayback, presetLocalStorage, SAMPLE_70MAI } from "../e2e/_fixtures.js";
import { isPortableMapRequest, openPortable, test } from "./_fixtures.js";

const tripCard = (page: Page) => page.locator("li.trip:not(.unindexed-note)").first();

async function editTrip(page: Page, name: string, note: string): Promise<void> {
    await tripCard(page).locator(".trip-edit").click();
    await page.locator("#trip-meta-name").fill(name);
    await page.locator("#trip-meta-note").fill(note);
    await page.locator("#trip-meta-save").click();
    await expect(page.locator("#trip-meta-modal")).toBeHidden();
}

async function chooseBrowserNotes(page: Page, label = "Only in this browser"): Promise<void> {
    const decision = page.locator("#notes-storage-modal");
    await expect(decision).toBeVisible();
    await decision.getByRole("button", { name: label, exact: true }).click();
    await expect(decision).toBeHidden();
}

async function addMarker(page: Page, text: string): Promise<void> {
    await page.locator("#player-add-marker").click();
    await page.locator("#marker-modal-text").fill(text);
    await page.locator("#marker-modal-save").click();
    await expect(page.locator("#marker-modal")).toBeHidden();
}

async function downloadNotes(page: Page, target: string): Promise<unknown> {
    await page.locator("#settings-btn").click();
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#settings-notes-export-btn").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^dashcamigo-notes-\d{4}-\d{2}-\d{2}\.dashcamigo$/);
    await download.saveAs(target);
    await page.locator("#settings-modal-close").click();
    const data: unknown = JSON.parse(await readFile(target, "utf8"));
    expect(data).toMatchObject({ app: "dashcamigo", format: "annotations", version: 2 });
    return data;
}

async function importNotes(page: Page, path: string): Promise<void> {
    await page.locator("#settings-btn").click();
    await page.locator("#settings-notes-import-input").setInputFiles(path);
    await expect(page.locator("#settings-notes-import-btn")).toBeEnabled();
    await page.locator("#settings-modal-close").click();
}

async function expectTripNotes(page: Page, name: string, note: string): Promise<void> {
    await expect(tripCard(page)).toContainText(name);
    await expect(tripCard(page).locator(".trip-fav")).toHaveAttribute("aria-pressed", "true");
    await tripCard(page).locator(".trip-edit").click();
    await expect(page.locator("#trip-meta-name")).toHaveValue(name);
    await expect(page.locator("#trip-meta-note")).toHaveValue(note);
    await page.locator("#trip-meta-cancel").click();
}

test("transfers notes to a moved dated HTML in a fresh profile and preserves newer edits when merging", async ({
    page,
    browser,
    requests,
}, info) => {
    void requests;
    await presetLocalStorage(page);
    await openPortable(page, info.outputPath("old-card"), "en", "dashcamigo-2026-09-24-en.html");
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await editTrip(page, "Card journey", "Roadworks by the bridge");
    await chooseBrowserNotes(page);
    await tripCard(page).locator(".trip-fav").click();
    await addMarker(page, "Bridge checkpoint");
    const backup = info.outputPath("saved-notes.dashcamigo");
    expect(await downloadNotes(page, backup)).toMatchObject({
        annotations: expect.arrayContaining([
            expect.objectContaining({
                kind: "tripMeta",
                name: "Card journey",
                note: "Roadworks by the bridge",
                isFavorite: true,
            }),
            expect.objectContaining({ kind: "marker", text: "Bridge checkpoint" }),
        ]),
    });

    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/is-loading/);
    await loadTrip(page, SAMPLE_70MAI);
    await expectTripNotes(page, "Card journey", "Roadworks by the bridge");
    await openPortable(page, info.outputPath("moved-card"), "en", "dashcamigo-2026-09-25-en.html");
    await loadTrip(page, SAMPLE_70MAI);
    await expectTripNotes(page, "Card journey", "Roadworks by the bridge");
    await page.close();

    const destination = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        locale: "ru-RU",
        serviceWorkers: "block",
    });
    try {
        const restored = await destination.newPage();
        const errors: string[] = [];
        const remoteRequests: string[] = [];
        restored.on("pageerror", (error) => errors.push(error.message));
        restored.on("request", (request) => {
            if (/^https?:/.test(request.url())) {
                remoteRequests.push(request.url());
                expect(request.method(), "portable requests are public GETs").toBe("GET");
                expect(request.postData()).toBeNull();
            }
        });
        await restored.route(/^https?:/, (route) => route.abort());
        await presetLocalStorage(restored);
        await openPortable(restored, info.outputPath("another-computer"), "en", "dashcamigo-2026-09-25-en.html");
        await loadTrip(restored, SAMPLE_70MAI);
        await pausePlayback(restored);
        await expect(tripCard(restored)).not.toContainText("Card journey");
        await importNotes(restored, backup);
        await expectTripNotes(restored, "Card journey", "Roadworks by the bridge");
        await expect(restored.locator(".timeline-marker-hit")).toHaveCount(1);
        await expect(restored.locator(".timeline-marker-hit")).toHaveAttribute("aria-label", "Bridge checkpoint");

        await editTrip(restored, "Updated journey", "A newer note on this computer");
        await chooseBrowserNotes(restored);
        await addMarker(restored, "Destination-only marker");
        await importNotes(restored, backup);
        await expectTripNotes(restored, "Updated journey", "A newer note on this computer");
        await expect(restored.locator(".timeline-marker-hit")).toHaveCount(2);
        const merged = await downloadNotes(restored, info.outputPath("merged-notes.dashcamigo"));
        expect(merged).toMatchObject({
            annotations: expect.arrayContaining([
                expect.objectContaining({
                    kind: "tripMeta",
                    name: "Updated journey",
                    note: "A newer note on this computer",
                    isFavorite: true,
                }),
                expect.objectContaining({ kind: "marker", text: "Bridge checkpoint" }),
                expect.objectContaining({ kind: "marker", text: "Destination-only marker" }),
            ]),
        });
        await restored.reload();
        await loadTrip(restored, SAMPLE_70MAI);
        await expectTripNotes(restored, "Updated journey", "A newer note on this computer");
        expect(errors, "notes transfer and reload have no uncaught errors").toEqual([]);
        expect(remoteRequests.filter((url) => url !== PORTABLE_UPDATE_URL && !isPortableMapRequest(url))).toEqual([]);
    } finally {
        await destination.close();
    }
});

test("starts with denied browser storage and downloads session-only notes", async ({ page, requests }, info) => {
    void requests;
    await page.addInitScript(() => {
        for (const property of ["localStorage", "sessionStorage", "indexedDB"]) {
            Object.defineProperty(window, property, {
                configurable: true,
                get() {
                    throw new DOMException("storage is disabled", "SecurityError");
                },
            });
        }
    });
    await openPortable(page, info.outputPath("blocked-storage"));
    await expect(page.locator("#landing-cta")).toBeEnabled();
    await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
    await expect(tripCard(page)).toBeVisible();
    await page.locator(".dc-onb__skip").click();
    await tripCard(page).click();
    await page.locator(".dc-onb__skip").click();
    await expect(page.locator("#player")).toBeVisible();
    await editTrip(page, "Session-only journey", "Keep this note in the downloaded backup");
    await chooseBrowserNotes(page, "Only for this tab");
    const backup = await downloadNotes(page, info.outputPath("session-notes.dashcamigo"));
    expect(backup).toMatchObject({
        annotations: expect.arrayContaining([
            expect.objectContaining({
                kind: "tripMeta",
                name: "Session-only journey",
                note: "Keep this note in the downloaded backup",
            }),
        ]),
    });
});

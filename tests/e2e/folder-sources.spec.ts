// The folder rows above the trip list: where the loaded trips came from, and
// (on the FSA path) remembering that folder, its notes file, forgetting it.
//
// Two halves, deliberately separate: the classic <input webkitdirectory> path
// runs everywhere and gets an informational row, the FSA path gets the
// controls. The second half drives a fake directory picker (see
// mockDirectoryPicker) - the only way to reach that code from a spec.

import type { Page } from "@playwright/test";

import {
    SAMPLE_70MAI,
    SAMPLE_GOPRO,
    expect,
    gotoApp,
    mockDirectoryPicker,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

const sourceRow = "#folder-sources .folder-source";

test.describe("folder sources, classic picker", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await gotoApp(page, "en");
    });

    test("names the folder the trips came from, without controls it cannot honour", async ({ page }) => {
        await expect(page.locator("#folder-sources")).toBeHidden();
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });

        const row = page.locator(sourceRow);
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("70mai-multichannel");
        // Files, not a reopenable folder: nothing here can be remembered, so the
        // row must not pretend otherwise.
        await expect(row.locator(".folder-source__remember")).toHaveCount(0);
        await expect(row.locator(".folder-source__status")).toHaveCount(0);
        await expect(row.locator(".folder-source__menu")).toHaveCount(0);
    });

    test("re-opening the same folder through the picker upgrades its row", async ({ page }) => {
        // The fake picker hands back the SAME root the plain input just loaded.
        await mockDirectoryPicker(page, [{ label: "70mai-multichannel", dir: SAMPLE_70MAI }]);
        await page.reload();
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        const row = page.locator(sourceRow);
        await expect(row).toHaveCount(1);
        await expect(row.locator(".folder-source__remember")).toHaveCount(0);

        await page.locator("#sidebar-cta").click();
        // The clips dedup away against what is already loaded, so the second
        // batch is a remnant at best - the row must still stay single AND learn
        // that it now has a reopenable folder behind it.
        await expect(row).toHaveCount(1);
        await expect(row.locator(".folder-source__remember")).toBeVisible();
    });
});

test.describe("folder sources, file-system picker", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await mockDirectoryPicker(page, [
            { label: "MOCKCARD", dir: SAMPLE_70MAI },
            { label: "SECONDCARD", dir: SAMPLE_GOPRO },
        ]);
        await gotoApp(page, "en");
    });

    test("offers to remember a picked folder, then keeps the offer settled", async ({ page }) => {
        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });

        const row = page.locator(sourceRow);
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("MOCKCARD");
        // The dot exists because this folder CAN be reopened; the offer is a
        // standing control, not a toast that expires.
        await expect(row.locator(".folder-source__status")).toHaveCount(1);
        await expect(page.locator(".dc-toast")).toHaveCount(0);

        await row.locator(".folder-source__remember").click();
        await expect(row.locator(".folder-source__state")).toHaveText(/Remembered/);
        await expect(row.locator(".folder-source__remember")).toHaveCount(0);
    });

    test("menu forgets the folder without disturbing the open trips", async ({ page }) => {
        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
        const row = page.locator(sourceRow);
        await row.locator(".folder-source__remember").click();
        await expect(row.locator(".folder-source__state")).toBeVisible();

        await row.locator(".folder-source__menu").click();
        const menu = row.locator(".folder-source__popup");
        await expect(menu).toBeVisible();
        // Connecting a notes file is an entry here, never an interrupting toast.
        await expect(menu).toContainText("Keep notes in a file");

        await menu.getByRole("button", { name: "Forget this folder" }).click();
        // Back to an offer, and the trips it produced are untouched.
        await expect(row.locator(".folder-source__remember")).toBeVisible();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible();
    });

    test("a second folder gets its own row", async ({ page }) => {
        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(sourceRow)).toHaveCount(1);

        // The second picker call hands back the other card (see the mock): a
        // different folder name AND different files, so nothing is deduped away.
        await page.locator("#sidebar-cta").click();
        await expect(page.locator(sourceRow)).toHaveCount(2);
        await expect(page.locator(sourceRow).nth(1)).toContainText("SECONDCARD");
    });
    test("a remembered folder from an earlier session shows as a loadable row", async ({ page }) => {
        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
        await page.locator(`${sourceRow} .folder-source__remember`).click();
        await expect(page.locator(".folder-source__state")).toBeVisible();

        // Next session: the trips come from somewhere else entirely, but the
        // remembered folder must still be one click away in the SOURCES list.
        await page.reload();
        await page.locator("#folder-input").setInputFiles(SAMPLE_GOPRO);
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });

        const unloaded = page.locator(".folder-source--unloaded");
        await expect(unloaded).toHaveCount(1);
        await expect(unloaded).toContainText("MOCKCARD");
        await expect(unloaded.locator(".folder-source__load")).toBeVisible();
        // Not loaded - nothing here can claim the trips on screen.
        await expect(unloaded.locator(".folder-source__remember")).toHaveCount(0);

        // Forgetting from the row removes it without touching the loaded trips.
        await unloaded.locator(".folder-source__menu").click();
        await unloaded.locator(".folder-source__popup").getByRole("button", { name: "Forget this folder" }).click();
        await expect(page.locator(".folder-source--unloaded")).toHaveCount(0);
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible();
    });

    test("a note taken before remembering re-attaches to the folder", async ({ page }) => {
        await page.locator("#landing-cta").click();
        const card = page.locator("li.trip:not(.unindexed-note)").first();
        await expect(card).toBeVisible({ timeout: 30_000 });

        // Star the trip while the folder is still session-only: the record is
        // stored with no folder on it.
        await card.locator(".trip-fav").click();
        await expect(card.locator(".trip-fav.is-on")).toBeVisible();
        expect(await storedAnnotationFolderIds(page), "the note starts unattached").toEqual([""]);

        await page.locator(`${sourceRow} .folder-source__remember`).click();
        await expect(page.locator(".folder-source__state")).toBeVisible();
        // Remembering adopts what was noted before it - otherwise those notes
        // would never reach the folder's notes file.
        await expect
            .poll(() => storedAnnotationFolderIds(page), { message: "the note moves onto the folder" })
            .toEqual([expect.not.stringMatching(/^$/)]);
    });
});

/** folderId of every stored annotation, read straight out of IndexedDB. */
async function storedAnnotationFolderIds(page: Page): Promise<string[]> {
    return page.evaluate(
        () =>
            new Promise<string[]>((resolve, reject) => {
                const request = indexedDB.open("dashcamigo");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const all = db.transaction("annotations").objectStore("annotations").getAll();
                    all.onerror = () => reject(all.error);
                    all.onsuccess = () => {
                        resolve((all.result as { folderId: string }[]).map((record) => record.folderId));
                        db.close();
                    };
                };
            }),
    );
}

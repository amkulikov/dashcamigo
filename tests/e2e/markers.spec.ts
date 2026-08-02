// Timeline markers end to end: drop one from the player bar, then find, rename
// and delete it through the marker list. The list is the only surface that
// works on touch (a pin needs contextmenu), so it is the one under a gate.

import { DESKTOP, boxOf, expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

/** Drops a marker at the playhead and dismisses the editor that opens with it. */
async function addMarker(page: import("@playwright/test").Page, text: string): Promise<void> {
    await page.locator("#player-add-marker").click();
    const modal = page.locator("#marker-modal");
    await expect(modal).toBeVisible();
    await page.locator("#marker-modal-text").fill(text);
    await page.locator("#marker-modal-save").click();
    await expect(modal).toBeHidden();
}

test.describe("timeline markers", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page);
    });

    test("the list button appears with the first marker and opens the trip's markers", async ({ page }) => {
        const listButton = page.locator("#player-marker-list");
        await expect(listButton, "no markers yet - the list button is a dead control").toBeHidden();

        await addMarker(page, "checkpoint");
        await expect(listButton).toBeVisible();
        await listButton.click();

        const rows = page.locator("#marker-list-items .marker-list-row");
        await expect(rows).toHaveCount(1);
        await expect(rows.first().locator(".marker-list-text")).toHaveValue("checkpoint");
        await expect(page.locator("#marker-list-empty")).toBeHidden();
    });

    test("renaming in the list persists to the pin", async ({ page }) => {
        await addMarker(page, "before");
        await page.locator("#player-marker-list").click();

        const textInput = page.locator("#marker-list-items .marker-list-text").first();
        await textInput.fill("after");
        await textInput.press("Enter");
        await page.locator("#marker-list-close").click();
        await expect(page.locator("#marker-list-modal")).toBeHidden();

        // The pin carries the text as its accessible name - proof the edit went
        // through the store and not just the input's own value.
        await expect(page.locator(".timeline-marker-hit").first()).toHaveAttribute("aria-label", "after");
    });

    test("a list row seeks back to its moment and closes the modal", async ({ page }) => {
        await addMarker(page, "start");
        const markerTime = (await page.locator("#player-current").textContent())?.trim();

        // Away from the marker, then back through the list.
        const ruler = await boxOf(page, "#player-chart-ruler-top");
        await page.mouse.click(ruler.x + ruler.width * 0.8, ruler.y + ruler.height / 2);
        await expect(page.locator("#player-current")).not.toHaveText(markerTime ?? "");

        await page.locator("#player-marker-list").click();
        await page.locator("#marker-list-items .marker-list-seek").first().click();
        // The backdrop hides the video, so a seek that left the modal open
        // would show the user nothing.
        await expect(page.locator("#marker-list-modal")).toBeHidden();
        await expect(page.locator("#player-current")).toHaveText(markerTime ?? "");
    });

    test("deleting the last marker empties the list and retracts the bar button", async ({ page }) => {
        await addMarker(page, "gone soon");
        await page.locator("#player-marker-list").click();
        await page.locator("#marker-list-items .marker-list-delete").first().click();

        await expect(page.locator("#marker-list-items .marker-list-row")).toHaveCount(0);
        await expect(page.locator("#marker-list-empty")).toBeVisible();
        await expect(page.locator(".timeline-marker")).toHaveCount(0);
        await expect(page.locator("#player-marker-list")).toBeHidden();
    });
});

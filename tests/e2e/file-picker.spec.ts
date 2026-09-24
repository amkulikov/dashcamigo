import type { Page } from "@playwright/test";
import {
    DESKTOP,
    expect,
    gotoApp,
    installExportCapture,
    loadTrip,
    openExport,
    presetLocalStorage,
    readExportResult,
    shot,
    test,
} from "./_fixtures.js";

async function prepare(
    page: Page,
    locale = "en",
    pickerOptions?: Parameters<typeof installExportCapture>[2],
): Promise<void> {
    await presetLocalStorage(page);
    await installExportCapture(page, undefined, pickerOptions);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page, locale);
    await loadTrip(page);
}

async function openSingleCameraExport(page: Page): Promise<void> {
    await openExport(page);
    const cameras = page.locator(".top-panel__channel-include");
    await cameras.nth(2).click();
    await cameras.nth(1).click();
    await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);
}

async function pickerCalls(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __exportPickerCalls: number }).__exportPickerCalls);
}

test("repeated Save events open only one native picker", async ({ page }) => {
    await prepare(page, "en", { pickerDelayMs: 30_000 });
    await openSingleCameraExport(page);
    const save = page.locator("#export-panel-save-btn");
    await save.click();
    for (let i = 0; i < 4; i++) await save.dispatchEvent("click");
    expect(await pickerCalls(page)).toBe(1);
    await expect(save).toBeDisabled();
    await expect(page.locator("#export-panel-error")).toBeHidden();
});

test("export recovers after the browser rejects an already active picker", async ({ page }) => {
    await prepare(page, "en", {
        pickerErrorOnce: {
            name: "NotAllowedError",
            message: "Failed to execute 'showSaveFilePicker' on 'Window': File picker already active.",
        },
    });
    await openSingleCameraExport(page);
    const save = page.locator("#export-panel-save-btn");
    await save.click();

    const error = page.locator("#export-panel-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("A file dialog is already open.");
    expect(await pickerCalls(page), "the failed picker is not retried automatically").toBe(1);
    expect(await readExportResult(page), "a failed picker never starts writing").toBeNull();

    await error.locator(".export-panel__primary-btn").click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator("#export-panel-done-summary")).toBeVisible();
    expect(await pickerCalls(page)).toBe(2);
    const output = await readExportResult(page);
    expect(output?.len).toBeGreaterThan(1024);
    expect(output?.gpmd, "a fresh user click saves the MP4 with GPS").toBe(true);
});

for (const [locale, warning] of [
    ["en", "A file dialog is already open."],
    ["ru", "Окно выбора файла уже открыто."],
] as const) {
    test(`export retries after the pending directory picker closes (${locale})`, async ({ page }) => {
        await prepare(page, locale);
        await page.evaluate(() => {
            const w = window as unknown as {
                showDirectoryPicker: () => Promise<never>;
                dismissDirectoryPicker: () => void;
            };
            w.showDirectoryPicker = () =>
                new Promise<never>((_resolve, reject) => {
                    w.dismissDirectoryPicker = () => reject(new DOMException("cancelled", "AbortError"));
                });
        });
        await page.locator("#sidebar-cta").click();
        await expect(page.locator("#ingest-overlay")).toBeVisible();
        await page.locator("#ingest-overlay-cancel").click();
        await expect(page.locator("#ingest-overlay")).toBeHidden();
        await openSingleCameraExport(page);
        const save = page.locator("#export-panel-save-btn");
        await save.click();

        const error = page.locator("#export-panel-error");
        await expect(error).toBeVisible();
        await expect(error).toContainText(warning);
        await expect(error.locator(".export-panel__error-status")).toBeFocused();
        await expect(error).toHaveCSS("opacity", "1");
        expect(await pickerCalls(page), "a pending directory picker prevents the native Save call").toBe(0);
        await shot(page, `file-picker-busy-${locale}`);

        await page.evaluate(() =>
            (window as unknown as { dismissDirectoryPicker: () => void }).dismissDirectoryPicker(),
        );
        await error.locator(".export-panel__primary-btn").click();
        await expect(save).toBeEnabled();
        await save.click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible();
        expect(await pickerCalls(page)).toBe(1);
        const output = await readExportResult(page);
        expect(output?.len).toBeGreaterThan(1024);
        expect(output?.gpmd, "the retry saves an MP4 with GPS through the native destination").toBe(true);
    });
}

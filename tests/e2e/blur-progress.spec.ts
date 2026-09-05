import type { Page } from "@playwright/test";
import { computeTrackerAssets } from "../../vite-plugins/tracker-assets.js";
import { DESKTOP, expect, gotoApp, loadTrip, openExport, presetLocalStorage, test } from "./_fixtures.js";

test.use({ serviceWorkers: "block" });

async function openBlurProgress(page: Page): Promise<void> {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await page.addInitScript((urls: string[]) => {
        // Exercise UI updates at the worker boundary without making inference
        // speed, model downloads or GPU availability part of this DOM contract.
        Object.defineProperty(navigator, "gpu", {
            value: { requestAdapter: async () => ({}) },
            configurable: true,
        });
        for (const url of urls) localStorage.setItem(`dashcamigo:blurAssetDownloaded:${url}`, "1");
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
            return urls.includes(url)
                ? Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
                : nativeFetch(input, init);
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            private isTracker: boolean;
            private progressData = new Map<string, object>();

            constructor(scriptURL: string | URL, options?: WorkerOptions) {
                super(scriptURL, options);
                this.isTracker = options?.name === "tracker-worker";
                if (!this.isTracker) return;
                for (const type of ["track", "detect"]) {
                    window.addEventListener(`e2e:${type}-progress`, (event) => {
                        if (!(event instanceof CustomEvent) || typeof event.detail !== "number") return;
                        const data = this.progressData.get(type);
                        if (!data) throw new Error("blur request missing");
                        this.dispatchEvent(
                            new MessageEvent("message", {
                                data: {
                                    __k: "ntf",
                                    type: `${type}-progress`,
                                    data: { ...data, fractionDone: event.detail },
                                },
                            }),
                        );
                    });
                }
            }

            override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
                if (this.isTracker && message && typeof message === "object" && "__k" in message) {
                    if (message.__k === "abort") return;
                    if (
                        message.__k === "req" &&
                        "type" in message &&
                        (message.type === "track" || message.type === "detect") &&
                        "data" in message &&
                        message.data &&
                        typeof message.data === "object"
                    ) {
                        this.progressData.set(message.type, message.data);
                        document.documentElement.setAttribute(`data-${message.type}-requested`, "true");
                        return;
                    }
                }
                if (Array.isArray(options)) super.postMessage(message, options);
                else super.postMessage(message, options);
            }
        };
    }, computeTrackerAssets("build").urls);
    await gotoApp(page, "en");
    await loadTrip(page);
    await openExport(page);
    const includes = page.locator(".top-panel__channel-include");
    await includes.nth(2).click();
    await includes.nth(1).click();
    await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);
}

async function addCenteredZone(page: Page): Promise<void> {
    await page.locator(".export-panel__blur-add-btn").click();
    await page.locator(".blur-draw-layer").press("Enter");
}

test("Follow progress preserves zone rows and keyboard focus", async ({ page }) => {
    await openBlurProgress(page);
    await addCenteredZone(page);
    await addCenteredZone(page);
    await expect(page.locator(".export-panel__blur-row")).toHaveCount(2);
    const follow = page.locator(".export-panel__blur-follow-btn").first();
    await follow.click();
    await expect(page.locator("html")).toHaveAttribute("data-track-requested", "true");
    await expect(follow).toHaveText("Following… 0%");
    await follow.focus();

    const changes = await page.evaluate(async () => {
        const rows = [...document.querySelectorAll(".export-panel__blur-row")];
        const list = rows[0]?.parentElement;
        if (!list) throw new Error("blur rows missing");
        const focus = document.activeElement;
        const observer = new MutationObserver(() => {});
        observer.observe(list, { childList: true });
        for (let pct = 1; pct <= 100; pct++) {
            window.dispatchEvent(new CustomEvent("e2e:track-progress", { detail: pct / 100 }));
        }
        const rowMutations = observer.takeRecords().length;
        observer.disconnect();
        return {
            rowMutations,
            sameRows: rows.every((row, index) => list.children[index] === row),
            sameFocus: document.activeElement === focus,
        };
    });

    expect(changes).toEqual({ rowMutations: 0, sameRows: true, sameFocus: true });
    await expect(follow).toHaveText("Following… 100%");
    await expect(page.locator("#export-panel-save-btn")).toBeDisabled();
    await follow.click();
    await expect(follow).toHaveText("Follow");
});

test("detection progress updates its bar without rebuilding nodes or repainting paused masks", async ({ page }) => {
    await openBlurProgress(page);
    await addCenteredZone(page);
    await page.locator("#export-panel-blur-plates").check();
    await expect(page.locator("html")).toHaveAttribute("data-detect-requested", "true");
    const status = page.locator(".export-panel__blur-detect-status");
    await expect(status.getByRole("progressbar")).toBeVisible();

    const changes = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const status = document.querySelector(".export-panel__blur-detect-status");
        const bar = status?.querySelector('[role="progressbar"]');
        if (!status || !bar) throw new Error("detection progress missing");
        let repaints = 0;
        const nativeClear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
            if (this.canvas.classList.contains("blur-preview-canvas")) repaints++;
            nativeClear.call(this, x, y, w, h);
        };
        const observer = new MutationObserver(() => {});
        observer.observe(status, { childList: true });
        let replacedStatusNodes = 0;
        try {
            for (let pct = 1; pct <= 100; pct++) {
                window.dispatchEvent(new CustomEvent("e2e:detect-progress", { detail: pct / 100 }));
                replacedStatusNodes += observer.takeRecords().length;
                await new Promise(requestAnimationFrame);
            }
            await new Promise(requestAnimationFrame);
            return { replacedStatusNodes, sameBar: status.contains(bar), repaints };
        } finally {
            CanvasRenderingContext2D.prototype.clearRect = nativeClear;
            observer.disconnect();
        }
    });

    expect(changes).toEqual({ replacedStatusNodes: 0, sameBar: true, repaints: 0 });
    await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await page.locator("#export-panel-blur-plates").uncheck();
});

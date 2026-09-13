import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

import {
    DESKTOP,
    SAMPLE_GOPRO,
    boxOf,
    expect,
    gotoApp,
    mockDirectoryPicker,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

test.beforeEach(async ({ page, browser }) => {
    // This suite must exercise the affected engine itself: spoofing its version
    // or replacing IndexedDB would hide the whole-browser crash regression.
    expect(
        Number(browser.version().split(".")[0]),
        "the compatibility gate runs on current Chromium",
    ).toBeGreaterThanOrEqual(153);
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
});

test("keeps notes writable and annotations persistent without storing file handles", async ({ page }, testInfo) => {
    await mockDirectoryPicker(page, [{ label: "SESSION-CARD", dir: SAMPLE_GOPRO }]);
    await gotoApp(page, "en");
    await page.locator("#landing-cta").click();
    const card = page.locator("li.trip:not(.unindexed-note)").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const source = page.locator("#folder-sources .folder-source");
    await expect(source).toContainText("SESSION-CARD");
    await expect(source.locator(".folder-source__remember")).toHaveCount(0);
    await expect(source.locator(".folder-source__state")).toHaveText("Reopen next time");

    await card.locator(".trip-fav").click();
    const storageModal = page.locator("#notes-storage-modal");
    await expect(storageModal).toBeVisible();
    await storageModal.getByRole("button", { name: "Save to a file" }).click();
    await expect(storageModal).toBeHidden();
    await expect(page.locator("#notes-file-status")).toContainText("Saving to notes.dashcamigo");
    await expect(page.locator("#notes-file-status")).toContainText("Choose this file again after reloading.");
    await captureHints(page, testInfo, "en");
    await expect
        .poll(
            () =>
                page.evaluate(async () => {
                    const handle = (window as unknown as { __e2eNotesFileHandle?: FileSystemFileHandle })
                        .__e2eNotesFileHandle;
                    if (!handle) return false;
                    const payload = JSON.parse(await (await handle.getFile()).text()) as {
                        annotations?: Array<{ kind?: string; isFavorite?: boolean }>;
                    };
                    return (
                        payload.annotations?.some((record) => record.kind === "tripMeta" && record.isFavorite) ?? false
                    );
                }),
            { message: "the real notes file receives the favorite in this session" },
        )
        .toBe(true);
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 0, notesFiles: 0, favorites: 1 });

    await page.reload();
    await expect(page.locator("#landing")).toBeVisible();
    await expect(page.locator("#notes-file-status")).toContainText("Notes are saved in this browser");
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 0, notesFiles: 0, favorites: 1 });

    await page.locator("#landing-cta").click();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(
        card.locator(".trip-fav.is-on"),
        "the annotation survives reload independently of file handles",
    ).toBeVisible();
    await page.locator(".notes-file > summary").click();
    const status = page.locator("#notes-file-status");
    await status.getByRole("button", { name: "Choose existing…" }).click();
    await expect(status).toContainText("notes.dashcamigo is connected");
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 0, notesFiles: 0, favorites: 1 });
});

test("opens a native local directory and notes handle without crashing on reload", async ({ page }, testInfo) => {
    const directory = testInfo.outputPath("NATIVE-CARD");
    await fs.cp(SAMPLE_GOPRO, directory, { recursive: true });
    await fs.writeFile(
        path.join(directory, "notes.dashcamigo"),
        JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations: [] }),
        "utf8",
    );
    // CDP delivers a trusted native file drop. Only the unautomatable OS picker
    // boundary is replaced; the directory, child handles and IndexedDB are real.
    await page.addInitScript(() => {
        let dropped: Promise<FileSystemHandle | null> | undefined;
        for (const type of ["dragenter", "dragover"]) {
            window.addEventListener(
                type,
                (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                },
                true,
            );
        }
        document.addEventListener(
            "drop",
            (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                const item = event.dataTransfer?.items[0] as
                    | (DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> })
                    | undefined;
                dropped = item?.getAsFileSystemHandle();
            },
            true,
        );
        window.showDirectoryPicker = async () => {
            const handle = await dropped;
            if (handle?.kind !== "directory") throw new Error("native directory drop is missing");
            return handle as FileSystemDirectoryHandle;
        };
    });
    await gotoApp(page, "ru");
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [directory], dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"] as const) {
        await cdp.send("Input.dispatchDragEvent", { type, x: 100, y: 100, data });
    }
    await cdp.detach();
    await page.locator("#landing-cta").click();
    await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
    const source = page.locator("#folder-sources .folder-source");
    await expect(source).toContainText("NATIVE-CARD");
    await expect(source.locator(".folder-source__remember")).toHaveCount(0);
    await expect(source.locator(".folder-source__state")).toHaveText("В следующий раз открой заново");
    await expect(page.locator("#notes-file-status")).toContainText("Файл notes.dashcamigo подключён");
    await expect(page.locator("#notes-file-status")).toContainText(
        "После перезагрузки страницы выбери этот файл заново.",
    );
    await captureHints(page, testInfo, "ru");
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 0, notesFiles: 0, favorites: 0 });

    // Simulate state written by an app version without the crash workaround.
    // Writing real handles is safe; reading them is the fatal Chromium path.
    await page.evaluate(async () => {
        const picker = window.showDirectoryPicker;
        if (!picker) throw new Error("native directory picker is missing");
        const handle = await picker();
        const sidecarHandle = await handle.getFileHandle("notes.dashcamigo");
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("dashcamigo");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction(["folders", "notesFile"], "readwrite");
                transaction.objectStore("folders").put({
                    id: "legacy-native-folder",
                    handle,
                    label: handle.name,
                    addedAt: Date.now(),
                    lastOpenedAt: Date.now(),
                    sidecarHandle,
                    sidecarAccess: "file",
                });
                transaction.objectStore("notesFile").put({ id: "global", handle: sidecarHandle, access: "file" });
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onerror = () => {
                    db.close();
                    reject(transaction.error);
                };
            };
        });
    });
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 1, notesFiles: 1, favorites: 0 });

    await page.reload();
    await expect(page.locator("#landing")).toBeVisible();
    await expect(page.locator("#notes-file-status")).toContainText("Заметки сохраняются в этом браузере.");
    await expect(page.locator(".folder-source--unloaded, .recent-folder-chip")).toHaveCount(0);
    await expect.poll(() => readPersistedState(page)).toEqual({ folders: 1, notesFiles: 1, favorites: 0 });
});

async function captureHints(page: Page, testInfo: TestInfo, locale: string): Promise<void> {
    await page.locator(".notes-file > summary").click();
    for (const [name, viewport] of [
        ["desktop", DESKTOP],
        ["narrow", { width: 320, height: 844 }],
    ] as const) {
        await page.setViewportSize(viewport);
        const sidebar = await boxOf(page, "#sidebar");
        for (const selector of [".folder-source__label", ".folder-source__reopen", "#notes-file-status"]) {
            const element = await boxOf(page, selector);
            expect(element.x, `${selector} fits the ${locale} ${name} sidebar`).toBeGreaterThanOrEqual(sidebar.x);
            expect(element.x + element.width, `${selector} fits the ${locale} ${name} sidebar`).toBeLessThanOrEqual(
                sidebar.x + sidebar.width,
            );
        }
        await page.screenshot({ path: testInfo.outputPath(`file-handle-hints-${locale}-${name}.png`) });
    }
    await page.setViewportSize(DESKTOP);
}

async function readPersistedState(page: Page): Promise<{ folders: number; notesFiles: number; favorites: number }> {
    return page.evaluate(
        () =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open("dashcamigo");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(["folders", "notesFile", "annotations"]);
                    const folders = transaction.objectStore("folders").count();
                    const notesFiles = transaction.objectStore("notesFile").count();
                    const annotations = transaction.objectStore("annotations").getAll();
                    transaction.oncomplete = () => {
                        resolve({
                            folders: folders.result,
                            notesFiles: notesFiles.result,
                            favorites: (annotations.result as Array<{ kind?: string; isFavorite?: boolean }>).filter(
                                (record) => record.kind === "tripMeta" && record.isFavorite,
                            ).length,
                        });
                        db.close();
                    };
                    transaction.onerror = () => {
                        reject(transaction.error);
                        db.close();
                    };
                };
            }),
    );
}

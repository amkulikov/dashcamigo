import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

import { readPortableArtifacts } from "../../scripts/_portable-artifacts.mjs";

const artifactDirectory = resolve("dist-portable");
const manifest = readPortableArtifacts(resolve(artifactDirectory, "manifest.json"), true);

test("reset preserves storage belonging to another local HTML application", async ({ page }, info) => {
    const artifact = manifest.files.en;
    expect(artifact, "English portable artifact exists").toBeDefined();
    const directory = info.outputPath("Карта памяти с пробелами");
    await mkdir(directory, { recursive: true });
    const target = resolve(directory, "offline viewer.html");
    await copyFile(resolve(artifactDirectory, artifact!.filename), target);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(target).href);
    await expect(page.locator("html")).not.toHaveClass(/is-loading/);

    await page.evaluate(async () => {
        localStorage.setItem("dashcamigo:reset-probe", "owned");
        localStorage.setItem("dc-theme", "dark");
        localStorage.setItem("dc.viewer.panels", "owned");
        localStorage.setItem("unrelated-local-app", "keep");
        localStorage.setItem("dc-other-app-key", "keep");
        sessionStorage.setItem("dashcamigo:reset-probe", "owned");
        sessionStorage.setItem("unrelated-local-app", "keep");
        for (const [name, store] of [
            ["dashcamigo", "meta"],
            ["unrelated-local-app", "records"],
        ] as const) {
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(name);
                request.onupgradeneeded = () => request.result.createObjectStore(store);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(store, "readwrite");
                    transaction.objectStore(store).put("keep", "reset-probe");
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
        }
    });
    await page.locator("#settings-btn").click();
    await page.locator("#settings-reset-btn").click();
    await expect(page.locator("#reset-confirm-modal")).toBeVisible();
    await expect(page.locator("#reset-confirm-modal")).not.toContainText("service worker");
    await Promise.all([page.waitForEvent("load"), page.locator("#reset-confirm-go").click()]);
    await expect(page.locator("html")).not.toHaveClass(/is-loading/);
    const after = await page.evaluate(async () => {
        const read = (name: string, store: string): Promise<unknown> =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open(name);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(store, "readonly");
                    const get = transaction.objectStore(store).get("reset-probe");
                    get.onsuccess = () => resolve(get.result);
                    get.onerror = () => reject(get.error);
                    transaction.oncomplete = () => db.close();
                };
            });
        return {
            ownedPreference: localStorage.getItem("dashcamigo:reset-probe"),
            ownedTheme: localStorage.getItem("dc-theme"),
            ownedPanels: localStorage.getItem("dc.viewer.panels"),
            otherPreference: localStorage.getItem("unrelated-local-app"),
            otherLegacyPreference: localStorage.getItem("dc-other-app-key"),
            ownedSession: sessionStorage.getItem("dashcamigo:reset-probe"),
            otherSession: sessionStorage.getItem("unrelated-local-app"),
            ownedDatabase: await read("dashcamigo", "meta"),
            otherDatabase: await read("unrelated-local-app", "records"),
        };
    });
    expect(after).toEqual({
        ownedPreference: null,
        ownedTheme: "auto",
        ownedPanels: null,
        otherPreference: "keep",
        otherLegacyPreference: "keep",
        ownedSession: null,
        otherSession: "keep",
        ownedDatabase: undefined,
        otherDatabase: "keep",
    });
    expect(errors, "reset and reload have no uncaught errors").toEqual([]);
});

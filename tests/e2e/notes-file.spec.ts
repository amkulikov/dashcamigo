// A notes file (*.dashcamigo) travelling inside the recordings folder is
// merged read-only during ingest - on EVERY open path, including the classic
// <input webkitdirectory> one this suite drives (no File System Access, the
// same shape as a fresh profile or incognito).
//
// The trip-meta anchor is a file identity (relativePath + size + mtime), and
// the mtime the browser reports is not under the spec's control (the upload
// plumbing does not preserve utimes). So the spec opens the folder once, reads
// the REAL identity off the input's FileList, writes the notes file with it,
// and opens the folder again - a re-drop of known clips still runs the notes
// merge (it happens before the duplicate cut), so the card must gain the name.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DESKTOP, SAMPLE_GOPRO, expect, gotoApp, mockDirectoryPicker, presetLocalStorage, test } from "./_fixtures.js";

const TRIP_NAME = "Named from notes file";

let tempRoot: string;
let sampleCopy: string;
let syncCopy: string;
let liveCopy: string;

test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dashcamigo-notes-e2e-"));
    sampleCopy = path.join(tempRoot, "gopro-notes");
    syncCopy = path.join(tempRoot, "gopro-notes-sync");
    liveCopy = path.join(tempRoot, "gopro-notes-live");
    await fs.cp(SAMPLE_GOPRO, sampleCopy, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, syncCopy, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, liveCopy, { recursive: true });
});

test.afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
});

test.describe("notes file in the recordings folder", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
    });

    test("merges at ingest and the trip card comes up named", async ({ page }) => {
        await gotoApp(page, "en");
        // The app clears the input after ingest (so the same folder can be
        // re-picked), so the FileList is stashed by a capture-phase listener
        // that runs ahead of the app's own change handler.
        await page.evaluate(() => {
            const input = document.getElementById("folder-input") as HTMLInputElement;
            input.addEventListener(
                "change",
                () => {
                    (window as unknown as Record<string, unknown>).__e2ePickedFiles = [...(input.files ?? [])].map(
                        (f) => ({ relativePath: f.webkitRelativePath, size: f.size, lastModified: f.lastModified }),
                    );
                },
                true,
            );
        });

        // First open: no notes file yet - this is where the clip's identity as
        // the browser sees it is read back.
        await page.locator("#folder-input").setInputFiles(sampleCopy);
        const firstTrip = page.locator("li.trip:not(.unindexed-note)").first();
        await expect(firstTrip, "a trip card must appear after ingest").toBeVisible({ timeout: 30_000 });
        await expect(firstTrip, "the name must not be there before the notes file exists").not.toContainText(TRIP_NAME);

        const clipIdentity = await page.evaluate(() => {
            const picked = (window as unknown as Record<string, unknown>).__e2ePickedFiles as
                | Array<{ relativePath: string; size: number; lastModified: number }>
                | undefined;
            const clip = picked?.find((f) => /\.(mp4|mov|ts)$/i.test(f.relativePath));
            if (!clip) throw new Error("no clip captured from the picked folder");
            return clip;
        });
        // NUL-joined, mirroring fileIdentityKey (src/persist/identity.ts).
        const identityKey = [clipIdentity.relativePath, clipIdentity.size, clipIdentity.lastModified].join(
            String.fromCharCode(0),
        );
        const payload = {
            app: "dashcamigo",
            format: "annotations",
            version: 1,
            savedAt: clipIdentity.lastModified,
            annotations: [
                {
                    id: "e2e-notes-trip-meta",
                    folderId: "written-on-another-machine",
                    updatedAt: clipIdentity.lastModified + 1,
                    deleted: false,
                    kind: "tripMeta",
                    anchor: { fileIdentityKey: identityKey, startUtc: clipIdentity.lastModified },
                    name: TRIP_NAME,
                },
            ],
        };
        await fs.writeFile(path.join(sampleCopy, "notes.dashcamigo"), JSON.stringify(payload), "utf8");

        // Second open of the SAME folder: clips dedup away, the notes file
        // merges anyway, and the annotated clip's card repaints with the name.
        // (The sample holds several clips = several trips - the name lands on
        // the one the record anchors to, so assert across the list.)
        await page.locator("#folder-input").setInputFiles(sampleCopy);
        await expect(
            page.locator("li.trip", { hasText: TRIP_NAME }),
            "the name from the notes file must land on its trip's card",
        ).toBeVisible({ timeout: 15_000 });
        const notesState = page.locator("#folder-sources .folder-source__notes", {
            hasText: "new changes aren't written to this file",
        });
        await expect(notesState, "the source row must disclose that the loaded file is read-only").toBeVisible();
        await expect(notesState).toContainText("notes.dashcamigo");
        await expect(
            page.locator("#folder-sources .folder-source"),
            "a notes-only duplicate pass must reuse the recording source row",
        ).toHaveCount(1);
    });

    test("upgrades a read-only notes file and writes the next change to it", async ({ page }) => {
        await fs.writeFile(
            path.join(syncCopy, "notes.dashcamigo"),
            JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations: [] }),
            "utf8",
        );
        const label = path.basename(syncCopy);
        await mockDirectoryPicker(page, [{ label, dir: syncCopy }]);
        await gotoApp(page, "en");

        await page.locator("#folder-input").setInputFiles(syncCopy);
        const card = page.locator("li.trip:not(.unindexed-note)").first();
        await expect(card).toBeVisible({ timeout: 30_000 });
        const row = page.locator("#folder-sources .folder-source", { hasText: label });
        await expect(row.locator(".folder-source__notes")).toContainText("new changes aren't written to this file");

        await row.getByRole("button", { name: "Enable file syncing…" }).click();
        const storageModal = page.locator("#notes-storage-modal");
        await expect(storageModal).toBeVisible();
        await storageModal.getByRole("button", { name: "Save to a file" }).click();
        await expect(storageModal).toBeHidden();
        await expect(row.locator(".folder-source__notes")).toHaveText(
            "Notes backup is on — changes are saved to the file notes.dashcamigo",
        );

        await card.locator(".trip-fav").click();
        await expect
            .poll(
                () =>
                    page.evaluate(async () => {
                        const roots = (window as unknown as { __e2eDirectoryPickerRoots?: MockDirectory[] })
                            .__e2eDirectoryPickerRoots;
                        const findNotes = async (dir: MockDirectory): Promise<MockFileHandle | null> => {
                            for await (const child of dir.values()) {
                                if (child.kind === "file" && child.name === "notes.dashcamigo") return child;
                                if (child.kind === "directory") {
                                    const found = await findNotes(child);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        const notes = roots?.[0] ? await findNotes(roots[0]) : null;
                        if (!notes) return false;
                        const payload = JSON.parse(await (await notes.getFile()).text()) as {
                            annotations?: Array<{ kind?: string; isFavorite?: boolean }>;
                        };
                        return (
                            payload.annotations?.some((record) => record.kind === "tripMeta" && record.isFavorite) ??
                            false
                        );
                    }),
                { message: "the first edit after connecting must reach notes.dashcamigo" },
            )
            .toBe(true);

        await page.reload();
        const reloadedRow = page.locator("#folder-sources .folder-source", { hasText: label });
        await expect(
            reloadedRow.locator(".folder-source__notes"),
            "a saved connection must not turn into a backup failure merely because the page reloaded",
        ).toHaveText("Notes backup is on — changes are saved to the file notes.dashcamigo");
    });

    test("shows a loaded notes file on an unremembered live folder", async ({ page }) => {
        await fs.writeFile(
            path.join(liveCopy, "notes.dashcamigo"),
            JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations: [] }),
            "utf8",
        );
        const label = path.basename(liveCopy);
        await mockDirectoryPicker(page, [{ label, dir: liveCopy }]);
        await gotoApp(page, "en");

        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });

        const row = page.locator("#folder-sources .folder-source", { hasText: label });
        await expect(row.locator(".folder-source__remember"), "the folder must still be session-only").toBeVisible();
        const notes = row.locator(".folder-source__notes");
        await expect(notes, "the row must disclose the notes file already used during ingest").toBeVisible();
        await expect(notes).toContainText("Notes loaded from notes.dashcamigo");

        await notes.getByRole("button", { name: "Enable file syncing…" }).click();
        await expect(row.locator(".folder-source__state")).toHaveText("Remembered");
        await expect(
            row.locator(".folder-source__notes"),
            "syncing should adopt the file from the already-open folder without another selection",
        ).toHaveText("Notes backup is on — changes are saved to the file notes.dashcamigo");
    });
});

interface MockFileHandle {
    kind: "file";
    name: string;
    getFile(): Promise<File>;
}

interface MockDirectory {
    kind: "directory";
    values(): AsyncIterableIterator<MockDirectory | MockFileHandle>;
}

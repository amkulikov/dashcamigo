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
let priorityFirst: string;
let prioritySecond: string;

test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dashcamigo-notes-e2e-"));
    sampleCopy = path.join(tempRoot, "gopro-notes");
    syncCopy = path.join(tempRoot, "gopro-notes-sync");
    liveCopy = path.join(tempRoot, "gopro-notes-live");
    priorityFirst = path.join(tempRoot, "gopro-notes-priority-first");
    prioritySecond = path.join(tempRoot, "gopro-notes-priority-second");
    await fs.cp(SAMPLE_GOPRO, sampleCopy, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, syncCopy, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, liveCopy, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, priorityFirst, { recursive: true });
    await fs.cp(SAMPLE_GOPRO, prioritySecond, { recursive: true });
});

test.afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
});

test.describe("old and portable notes files", () => {
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
        await expect(
            page.locator("#notes-file-status"),
            "reading a travelling old file must not bind it to a folder or make it writable",
        ).toContainText("Notes are saved in this browser");
        await expect(
            page.locator("#folder-sources .folder-source"),
            "a notes-only duplicate pass must reuse the recording source row",
        ).toHaveCount(1);
    });

    test("opens v1 read-only, then upgrades it on the first writing action", async ({ page }) => {
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
        await page.locator(".notes-file > summary").click();
        const notesStatus = page.locator("#notes-file-status");
        await expect(notesStatus).toContainText("Notes are saved in this browser");
        await notesStatus.getByRole("button", { name: "Choose existing…" }).click();
        await expect(notesStatus).toContainText("notes.dashcamigo is connected");

        const beforeWrite = await page.evaluate(async () => {
            const handle = (window as unknown as { __e2eNotesFileHandle?: FileSystemFileHandle }).__e2eNotesFileHandle;
            return handle ? await (await handle.getFile()).text() : "";
        });
        expect(JSON.parse(beforeWrite).version, "choosing an old file itself stays read-only").toBe(1);

        await card.locator(".trip-fav").click();
        const storageModal = page.locator("#notes-storage-modal");
        await expect(storageModal).toBeVisible();
        await storageModal.getByRole("button", { name: "Save to a file" }).click();
        await expect(storageModal).toBeHidden();
        await expect(notesStatus).toContainText("Saving to notes.dashcamigo");
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
                            version?: number;
                            annotations?: Array<{ kind?: string; isFavorite?: boolean }>;
                        };
                        return (
                            payload.version === 2 &&
                            (payload.annotations?.some((record) => record.kind === "tripMeta" && record.isFavorite) ??
                                false)
                        );
                    }),
                { message: "the first edit after connecting must reach notes.dashcamigo" },
            )
            .toBe(true);

        await page.reload();
        await expect(
            page.locator("#notes-file-status"),
            "a saved connection must not turn into a backup failure merely because the page reloaded",
        ).toContainText("Saving to notes.dashcamigo");
    });

    test("a notes file in the newly opened folder replaces the previous fallback", async ({ page }) => {
        await fs.writeFile(
            path.join(prioritySecond, "notes.dashcamigo"),
            JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations: [] }),
            "utf8",
        );
        await mockDirectoryPicker(page, [
            { label: "FIRST-CARD", dir: priorityFirst },
            { label: "SECOND-CARD", dir: prioritySecond },
        ]);
        await gotoApp(page, "en");
        await page.evaluate(() => {
            (window as unknown as { __e2eSaveNotesAs?: string }).__e2eSaveNotesAs =
                "dashcamigo-report-2026-08-26-0745.dashcamigo";
        });

        await page.locator("#landing-cta").click();
        const card = page.locator("li.trip:not(.unindexed-note)").first();
        await expect(card).toBeVisible({ timeout: 30_000 });
        await card.locator(".trip-fav").click();
        const decision = page.locator("#notes-storage-modal");
        await expect(decision).toBeVisible();
        await decision.getByRole("button", { name: "Save to a file" }).click();
        await expect(decision).toBeHidden();

        await page.locator(".notes-file > summary").click();
        const status = page.locator("#notes-file-status");
        await expect(status).toContainText("Saving to dashcamigo-report-2026-08-26-0745.dashcamigo");
        await expect(status.getByRole("button")).toHaveCount(1);
        await expect(status.getByRole("button", { name: "Change file…" })).toBeVisible();
        const previousText = await page.evaluate(async () => {
            const state = window as unknown as {
                __e2eNotesFileHandle?: FileSystemFileHandle;
                __e2ePreviousNotesFileHandle?: FileSystemFileHandle;
            };
            if (!state.__e2eNotesFileHandle) throw new Error("custom notes file was not created");
            state.__e2ePreviousNotesFileHandle = state.__e2eNotesFileHandle;
            return (await state.__e2eNotesFileHandle.getFile()).text();
        });

        await page.locator("#sidebar-cta").click();
        await expect(
            status,
            "the conventional notes file in the latest folder must replace the previous fallback",
        ).toContainText("notes.dashcamigo is connected");
        await expect(status.getByRole("button")).toHaveCount(1);
        await expect(status.getByRole("button", { name: "Change file…" })).toBeVisible();

        await card.locator(".trip-fav").click();
        await expect(decision).toBeVisible();
        await decision.getByRole("button", { name: "Save to a file" }).click();
        await expect(decision).toBeHidden();
        await expect(status).toContainText("Saving to notes.dashcamigo");

        await expect
            .poll(
                () =>
                    page.evaluate(async () => {
                        const handle = (window as unknown as { __e2eNotesFileHandle?: FileSystemFileHandle })
                            .__e2eNotesFileHandle;
                        if (!handle) return 0;
                        return (JSON.parse(await (await handle.getFile()).text()) as { version?: number }).version ?? 0;
                    }),
                { message: "the newly opened folder's file must receive the next edit" },
            )
            .toBe(2);
        expect(
            await page.evaluate(async () => {
                const handle = (window as unknown as { __e2ePreviousNotesFileHandle?: FileSystemFileHandle })
                    .__e2ePreviousNotesFileHandle;
                return handle ? await (await handle.getFile()).text() : "";
            }),
            "switching folders must not write the discovered file's merge back into the previous fallback",
        ).toBe(previousText);
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
        const notes = page.locator("#notes-file-status");
        await expect(notes, "the folder's notes file must become current without becoming writable").toContainText(
            "notes.dashcamigo is connected",
        );
        await expect(row.locator(".folder-source__remember")).toBeVisible();
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

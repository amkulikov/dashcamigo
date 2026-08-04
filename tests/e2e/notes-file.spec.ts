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

import { DESKTOP, SAMPLE_GOPRO, expect, gotoApp, presetLocalStorage, test } from "./_fixtures.js";

const TRIP_NAME = "Named from notes file";

let tempRoot: string;
let sampleCopy: string;

test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dashcamigo-notes-e2e-"));
    sampleCopy = path.join(tempRoot, "gopro-notes");
    await fs.cp(SAMPLE_GOPRO, sampleCopy, { recursive: true });
});

test.afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
});

test.describe("notes file in the recordings folder", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    test("merges at ingest and the trip card comes up named", async ({ page }) => {
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
    });
});

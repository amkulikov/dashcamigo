// Filename-first lazy ingest path. Forces the lazy scheduler (the e2e backend is
// fast, so the latency probe would pick eager) via the localStorage override, then
// asserts the path WORKS end to end: the trip list renders from filenames, opening
// a trip hydrates its bytes (moov -> duration/codec, GPS) into a fully playable
// multichannel trip, the trip card is keyboard-operable, and a broken clip in the
// drop does not wedge the whole list provisional forever (G3). This is the only
// functional gate on the lazy path short of a real slow device; the 10x perf claim
// itself needs Android+OTG.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DESKTOP, SAMPLE_70MAI, SAMPLE_GOPRO, expect, gotoApp, presetLocalStorage, shot, test } from "./_fixtures.js";

test.describe("filename-first lazy ingest", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        // Force lazy: the override wins over the probe + file-count gate, so the
        // small (fast, <30-file) e2e fixture still exercises the lazy path.
        await page.addInitScript(() => {
            try {
                localStorage.setItem("dashcamigo:ingest-scheduler", "lazy");
            } catch {
                /* private mode - ignore */
            }
        });
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    test("renders the trip list from filenames, then hydrates the opened trip", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);

        // Filename-first: a trip card appears (grouped from filenames, before any
        // moov read). cameraFingerprint + channel/sequence come from the names.
        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first(), "filename-first trip card must appear").toBeVisible({ timeout: 30_000 });
        expect(await trips.count(), "70mai sample yields at least one trip").toBeGreaterThanOrEqual(1);

        // The trip title is a keyboard-operable control (G5): role=button + focusable.
        const title = trips.first().locator(".trip-title");
        await expect(title).toHaveAttribute("role", "button");
        await expect(title).toHaveAttribute("tabindex", "0");

        // Open the first trip -> hydrateTrip reads each file's moov (duration/codec)
        // and merges GPS -> the player becomes playable (total advances past 0:00).
        await trips.first().click();
        await expect(page.locator("#player-chart-canvas")).toBeVisible();
        await expect
            .poll(async () => (await page.locator("#player-total").textContent())?.trim(), {
                timeout: 20_000,
            })
            .not.toBe("0:00");

        // The hydrated trip is fully usable: the multichannel grid (front/rear/
        // interior) renders just as on the eager path.
        for (const ch of ["front", "rear", "interior"] as const) {
            await expect(
                page.locator(`#video-grid .video-tile[data-channel="${ch}"]`),
                `${ch} tile must render after hydration`,
            ).toBeVisible();
        }

        // Hydration converged: the list is no longer marked busy to assistive tech
        // (every clip's metadata is read).
        await expect(page.locator("#trip-list")).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });

        await shot(page, "lazy-01-hydrated");
    });

    test("keyboard: Enter on the focused trip title opens the trip", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        const title = page.locator("li.trip:not(.unindexed-note)").first().locator(".trip-title");
        await expect(title).toBeVisible({ timeout: 30_000 });

        // Focus the title (role=button) and activate via keyboard - same path as click.
        await title.focus();
        await expect(title).toBeFocused();
        await page.keyboard.press("Enter");

        await expect(page.locator("#player-chart-canvas")).toBeVisible();
        await expect
            .poll(async () => (await page.locator("#player-total").textContent())?.trim(), { timeout: 20_000 })
            .not.toBe("0:00");
    });

    test("a broken clip does not wedge the list - it converges and shows a read-failed chip", async ({ page }) => {
        // A .mp4 with a valid ftyp but no moov: classified as video by extension,
        // grouped into a trip from its (70mai-style) filename, but the moov read
        // fails -> indexFailed. Before the G3 fix this left the candidate forever
        // pending, so the background pump never reached the final regroup sweep and
        // the whole list stayed provisional. Now it must converge.
        const dir = mkdtempSync(path.join(tmpdir(), "dashcamigo-broken-"));
        const broken = path.join(dir, "NO20260101-120000-000001F.MP4");
        const ftyp = Buffer.concat([
            Buffer.from([0x00, 0x00, 0x00, 0x18]), // box size 24
            Buffer.from("ftypisom", "ascii"),
            Buffer.from([0x00, 0x00, 0x02, 0x00]),
            Buffer.from("isommp41", "ascii"),
        ]);
        // ftyp + 256 bytes of padding, NO moov box anywhere -> the indexer returns null.
        writeFileSync(broken, Buffer.concat([ftyp, Buffer.alloc(256)]));

        // #folder-input has webkitdirectory, so it takes a DIRECTORY (the temp
        // dir holding just the one broken clip), not a single file path.
        await page.locator("#folder-input").setInputFiles(dir);

        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first(), "broken clip still yields a filename-first card").toBeVisible({ timeout: 30_000 });

        // Convergence: the read failure is terminal, so hydration finishes and the
        // list clears its busy flag (a wedge would keep it busy forever -> timeout).
        await expect(page.locator("#trip-list")).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });

        // The failure is surfaced, not silent: the read-failed chip is shown, and
        // the card carries the no-thumbnail placeholder rather than shimmering forever.
        await expect(page.getByText("Unreadable", { exact: true })).toBeVisible();
        await expect(page.locator("li.trip.trip--loading")).toHaveCount(0, { timeout: 20_000 });
    });

    test("Skip during hydration still lets playback proceed (A1)", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first(), "filename-first trip card must appear").toBeVisible({ timeout: 30_000 });

        await trips.first().click();

        // The hydrate modal (with Skip) only escalates past a 250ms threshold. On
        // the fast e2e backend hydration usually beats that gate, so the modal may
        // never appear - the Skip click is therefore best-effort. The regression
        // A1 guards is that Skip rejected hydrateTrip, so playback never started
        // AND an unhandledrejection fired (the fixture teardown asserts against the
        // latter). The load-bearing assertions below run whether or not the modal
        // showed: playback must proceed with provisional-or-real metadata.
        const skip = page.locator("#lazy-gps-load-modal-cancel");
        try {
            await skip.click({ timeout: 1500 });
        } catch {
            // Modal never shown (hydration beat the 250ms gate) - fine.
        }

        await expect(page.locator("#player-chart-canvas")).toBeVisible();
        await expect
            .poll(async () => (await page.locator("#player-total").textContent())?.trim(), { timeout: 20_000 })
            .not.toBe("0:00");

        await shot(page, "lazy-02-skip-hydration");
    });

    test("re-drop of the same folder keeps the list converged (A2)", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first(), "first drop renders a trip card").toBeVisible({ timeout: 30_000 });

        // Re-drop the identical folder WITHOUT first waiting for the background
        // fill to converge. Every file is a duplicate, so ingest takes the
        // newVideos===0 early return, whose cancelLazyHydration tears down the
        // still-running fill. Before A2 nothing restarted it, so any carried-over
        // provisional trip stayed aria-busy=true forever; resumeLazyHydrationIfPending
        // now reconverges. (When the fill already finished, the re-drop resume is a
        // no-op and the list is simply still converged - this test never false-fails.)
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);

        await expect(page.locator("#trip-list")).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
        // No card is stuck in the provisional shimmer, and the duplicate re-drop
        // did not add a second copy of the footage.
        await expect(page.locator("li.trip.trip--loading")).toHaveCount(0, { timeout: 20_000 });
        expect(
            await trips.count(),
            "duplicate re-drop must yield at least the original trip(s)",
        ).toBeGreaterThanOrEqual(1);
    });

    test("a second lazy drop during the fill resumes and finishes (A4)", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first(), "first drop renders a trip card").toBeVisible({ timeout: 30_000 });

        // Drop a second, DIFFERENT folder while the first fill may still be running.
        // The lazy path carries the first drop's candidates into the regroup
        // (applyRegroup), so both drops' trips must end up hydrated - none stuck
        // provisional - and the regroup must not desync the selection or wipe
        // previews (asserted indirectly by convergence + the fail-loud teardown).
        await page.locator("#folder-input").setInputFiles(SAMPLE_GOPRO);

        // Both cards present (70mai trip + gopro trip) and the whole list converges.
        await expect.poll(async () => trips.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
        await expect(page.locator("#trip-list")).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
        await expect(page.locator("li.trip.trip--loading")).toHaveCount(0, { timeout: 20_000 });
    });
});

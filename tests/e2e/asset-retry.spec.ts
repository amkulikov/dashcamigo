// The boot-time self-heal for the CF-edge propagation window (docs/deploy.md,
// "Deployment pipeline"): right after a deploy the edge can serve fresh HTML
// whose hashed assets still 404, and the shell must retry by itself instead
// of standing dead. Fault injection: the first load 404s every /assets/*.js,
// the retry in index.html's dc-bootstrap reloads after the routes are lifted,
// and the app must boot for real.

import { expect, test } from "./_fixtures.js";

// The injected fault IS the browser's own "Failed to load resource" console
// error - tolerate exactly that line, nothing else.
test.use({ tolerateConsole: [/Failed to load resource/] });

const HASHED_JS = /\/assets\/[^/?]+\.js$/;

test("dead shell reloads itself and boots once the assets come back", async ({ page }) => {
    let blockedRequests = 0;
    await page.route(HASHED_JS, (route) => {
        blockedRequests += 1;
        return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
    });

    await page.goto("/en/");
    // The entry <script> error settles before window load, so by now the
    // bootstrap must have spent a retry from the budget. >= 1, not === 1: on
    // a slow runner the first scheduled reload may already have burned
    // another attempt against the still-active routes.
    const spentAttempts = await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"));
    expect(Number(spentAttempts), "the retry budget was spent").toBeGreaterThanOrEqual(1);
    expect(blockedRequests, "the fault was actually injected").toBeGreaterThan(0);

    // A pending reload announces itself instead of firing silently; the text
    // asserts the lang wiring too (en page -> the English literal).
    await expect(page.locator("#dc-retry-note")).toHaveText("Updating the app…");

    await page.unroute(HASHED_JS);

    // The first retry fires ~4s in; after the reload the entry executes and
    // initFileSources() drops the shipped .is-pending off the landing CTA -
    // the signal that real app code ran, not just static HTML. 30s covers a
    // second-attempt run (15s backoff) on a slow runner.
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/, { timeout: 30_000 });

    // A successful boot takes the updating note down immediately, but returns
    // the budget only after 30s of stable uptime - a boot that succeeds right
    // before a lazy chunk 404s must not reset the counter (the infinite-loop
    // guard), hence the generous poll timeout.
    await expect(page.locator("#dc-retry-note")).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("dc-asset-retry")), { timeout: 45_000 })
        .toBe(null);
});

test("a lazy-chunk failure after boot reloads on the ladder, not instantly", async ({ page }) => {
    await page.goto("/en/");
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/);

    // The listener reacts to the event itself, so a synthetic dispatch stands
    // in for a real chunk 404 - no fault injection needed after boot.
    await page.evaluate(() => {
        (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument = true;
        window.dispatchEvent(new Event("vite:preloadError"));
    });

    // The reload announces itself and spends a retry from the shared budget...
    await expect(page.locator("#dc-retry-note")).toHaveText("Updating the app…");
    expect(await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBe("1");

    // ...but does NOT fire immediately: the first ladder rung is 4s, so 2s in
    // this must still be the same document. An instant reload here is the
    // flicker-loop regression this test pins down.
    await page.waitForTimeout(2000);
    expect(
        await page.evaluate(() => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument),
        "no reload before the ladder delay",
    ).toBe(true);

    // The scheduled reload then lands: the marker dies with the old document.
    await page.waitForFunction(
        () => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument === undefined,
        undefined,
        { timeout: 10_000 },
    );
});

test("a spent budget stops the post-boot reload entirely", async ({ page }) => {
    // Seed the budget as exhausted before the app boots; the boot itself is
    // healthy, and dc:ready only returns the budget after 30s - well past
    // this test's window.
    await page.addInitScript(() => sessionStorage.setItem("dc-asset-retry", "4"));
    await page.goto("/en/");
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/);

    await page.evaluate(() => {
        (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument = true;
        window.dispatchEvent(new Event("vite:preloadError"));
    });

    // Past the first ladder rung (4s): no note, no reload, budget untouched.
    await page.waitForTimeout(5000);
    await expect(page.locator("#dc-retry-note")).toHaveCount(0);
    expect(
        await page.evaluate(() => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument),
        "the document survived - no reload past the cap",
    ).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBe("4");
});

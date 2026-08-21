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
    await page.clock.install();
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

    // Cross the first 4s rung with the browser's clock. Waiting four real
    // seconds here only tested Playwright's patience; the marker below proves
    // that the timer did reload the document.
    const reload = page.waitForNavigation();
    await page.clock.fastForward(4000);
    await reload;
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/);

    // A successful boot takes the updating note down immediately, but returns
    // the budget only after 30s of stable uptime - a boot that succeeds right
    // before a lazy chunk 404s must not reset the counter (the infinite-loop
    // guard). Advance that stability window without adding 30 seconds to every
    // suite run.
    await expect(page.locator("#dc-retry-note")).toHaveCount(0);
    await page.clock.fastForward(30_000);
    expect(await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBeNull();
});

test("a lazy-chunk failure after boot reloads on the ladder, not instantly", async ({ page }) => {
    await page.clock.install();
    await page.goto("/en/");
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/);
    // pauseAt must target the future; leave headroom between reading the page's
    // clock and sending the protocol command on a saturated CI host.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

    // The listener reacts to the event itself, so a synthetic dispatch stands
    // in for a real chunk 404 - no fault injection needed after boot.
    await page.evaluate(() => {
        (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument = true;
        window.dispatchEvent(new Event("vite:preloadError"));
    });

    // The reload announces itself and spends a retry from the shared budget...
    await expect(page.locator("#dc-retry-note")).toHaveText("Updating the app…");
    expect(await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBe("1");

    // ...but does NOT fire before the first 4s ladder rung. An instant reload
    // here is the flicker-loop regression this test pins down.
    await page.clock.fastForward(3999);
    expect(
        await page.evaluate(() => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument),
        "no reload before the ladder delay",
    ).toBe(true);

    // The scheduled reload then lands: the marker dies with the old document.
    const reload = page.waitForNavigation();
    await page.clock.fastForward(1);
    await reload;
    expect(
        await page.evaluate(() => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument),
    ).toBeUndefined();
});

test("a spent budget stops the post-boot reload entirely", async ({ page }) => {
    await page.clock.install();
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
    await page.clock.fastForward(5000);
    await expect(page.locator("#dc-retry-note")).toHaveCount(0);
    expect(
        await page.evaluate(() => (window as unknown as { __dcSameDocument?: boolean }).__dcSameDocument),
        "the document survived - no reload past the cap",
    ).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBe("4");
});

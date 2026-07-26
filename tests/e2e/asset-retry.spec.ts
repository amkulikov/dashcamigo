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

    await page.unroute(HASHED_JS);

    // The first retry fires ~4s in; after the reload the entry executes and
    // initFileSources() drops the shipped .is-pending off the landing CTA -
    // the signal that real app code ran, not just static HTML. 30s covers a
    // second-attempt run (15s backoff) on a slow runner.
    await expect(page.locator(".landing-cta").first()).not.toHaveClass(/is-pending/, { timeout: 30_000 });

    // A successful boot returns the budget (dc:ready clears the counter).
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("dc-asset-retry"))).toBe(null);
});

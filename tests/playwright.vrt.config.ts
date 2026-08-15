// Visual-regression (pixel-diff) config - SEPARATE from the e2e gate on purpose.
//
// toHaveScreenshot baselines are platform-specific (the filename carries
// `-chromium-<os>`), so a macOS-generated baseline does NOT match a Linux CI
// run. This config is therefore NOT wired into the blocking CI job: it is a
// local/opt-in pixel guard for stable layout regions. To run it in CI, first
// commit Linux baselines generated in the Playwright Docker image:
//   docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c "npm ci && npm run build && npx playwright test --config=tests/playwright.vrt.config.ts --update-snapshots"
//
// Targets only deterministic surfaces (landing, modals, export panel with the
// live video grid masked). The map canvas and video frames are never snapshotted
// - they are nondeterministic (WebGL/SwiftShader, frame timing) and must be
// masked or asserted functionally (see tests/e2e/*.spec.ts) instead.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// Run artifacts (traces, failure screenshots, the HTML report) are pinned next
// to this config instead of Playwright's default, which resolves them against
// the CURRENT WORKING DIRECTORY - every run starts from the repo root, so they
// landed there, outside the .gitignore entry and outside the path ci.yml
// uploads.
const ARTIFACT_ROOT = dirname(fileURLToPath(import.meta.url));

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: "./e2e",
    outputDir: resolve(ARTIFACT_ROOT, "test-results"),
    testMatch: "**/*.vrt.ts",
    workers: 1,
    fullyParallel: false,
    forbidOnly: isCI,
    retries: 0,
    timeout: 60 * 1000,
    expect: {
        timeout: 10 * 1000,
        // Small tolerance absorbs antialiasing without hiding real changes.
        // Caveat: the modal locators are full-viewport overlays, so a small
        // intended change (one added settings row) can dilute under this ratio
        // and PASS - and --update-snapshots rewrites only on mismatch, leaving
        // the baseline stale. To refresh deliberately: delete the PNG, rerun
        // with --update-snapshots, and eyeball the regenerated image.
        toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
    },
    use: {
        // See playwright.e2e.config.ts: PW_CHANNEL=chrome on Linux for codecs.
        channel: process.env.PW_CHANNEL || "chromium",
        headless: true,
        baseURL: "http://localhost:4173",
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    },
    reporter: [["list"]],
    webServer: {
        command: "npm run preview -- --port 4173",
        port: 4173,
        reuseExistingServer: !isCI,
        timeout: 60 * 1000,
        stdout: "ignore",
        stderr: "pipe",
    },
});

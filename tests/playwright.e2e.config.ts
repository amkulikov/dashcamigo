// Playwright config for the e2e regression suite (tests/e2e/).
//
// This is the assertion-driven, fail-loud gate meant to replace manual
// click-through testing - distinct from:
//  - playwright.perf.config.ts   -> perf timings (tests/perf/)
//
// Design choices baked in here:
//  - workers: 1 / fullyParallel: false - one preview server, heavy multichannel
//    ingest (WebCodecs + MSE), and a shared 4173 port. Sequential keeps runs
//    deterministic; the suite is small enough that wall-clock is fine.
//  - channel "chromium" (full, not headless-shell) - WebGL (MapLibre) and
//    WebCodecs (decode/transcode) need the real pipeline.
//  - --autoplay-policy=no-user-gesture-required - headless Chrome blocks
//    programmatic video.play(); we drive playback through real button clicks
//    (trusted events) but the flag removes the gate for any rAF-driven preview.
//  - trace on-first-retry - cheap post-mortem exactly when a flake/regression
//    happens, per Playwright CI guidance.
//  - retries 2 on CI only - a stabilizer for shared runners, NOT a substitute
//    for web-first assertions. A retry-only pass is a flake to investigate.

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

// Opt-in second engine. The default suite runs Chromium only (the bar that gates
// CI); set PW_FIREFOX=1 to ALSO run on real Firefox - it natively lacks
// showSaveFilePicker, so it is the only way to exercise the in-memory (RAM)
// export path on a non-Chromium engine. Gated because Gecko's H.264 decode is
// not guaranteed on every host (same class of caveat as PW_CHANNEL for Chromium)
// and Firefox has no WebCodecs H.264 ENCODE (Bugzilla 1918769), so the re-encode
// export specs self-skip there. See docs/browser-support.md and the e2e README.
const withFirefox = !!process.env.PW_FIREFOX;

export default defineConfig({
    testDir: "./e2e",
    outputDir: resolve(ARTIFACT_ROOT, "test-results"),
    workers: 1,
    fullyParallel: false,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    timeout: 60 * 1000,
    expect: { timeout: 10 * 1000 },
    use: {
        // Shared, engine-agnostic options; per-engine specifics live in projects.
        headless: true,
        screenshot: "off", // specs screenshot explicitly as review artifacts
        video: "off",
        trace: "on-first-retry",
        baseURL: "http://localhost:4173",
        // No --autoplay-policy override: tests drive playback through real button
        // clicks (trusted gestures), which the policy already permits. Forcing
        // autoplay let the muted master start on load and then stall the
        // multichannel sync, making the initial play state nondeterministic.
    },
    projects: [
        {
            // The bundled "chromium" lacks proprietary codecs (no H.264/AAC
            // decode), so a real trip shows the "no decoder" overlay and the
            // player never activates. macOS chromium decodes H.264 via the OS, so
            // local runs work; on Linux CI set PW_CHANNEL=chrome (Google Chrome
            // ships the codecs).
            name: "chromium",
            use: { channel: process.env.PW_CHANNEL || "chromium" },
        },
        ...(withFirefox
            ? [
                  {
                      name: "firefox",
                      use: { browserName: "firefox" as const },
                      // Scope to the export-run spec: Firefox's value here is the
                      // in-memory (no native picker) export path on a non-Chromium
                      // engine. Bringing the whole suite up on Gecko is a separate
                      // effort (each spec needs its own engine-specific noise/skip
                      // tuning); this keeps the opt-in run focused and green.
                      testMatch: /export-run\.spec\.ts/,
                  },
              ]
            : []),
    ],
    // github: inline PR annotations for failures. html: post-mortem artifact
    // (uploaded if: always(), so a retry-then-pass flake keeps its trace).
    reporter: isCI
        ? [["list"], ["github"], ["html", { open: "never", outputFolder: resolve(ARTIFACT_ROOT, "playwright-report") }]]
        : [["list"]],
    webServer: {
        // Serves whatever is in dist/. The npm script (`test:e2e`) runs `build`
        // first; locally `reuseExistingServer` skips the rebuild+boot wait on
        // iterative runs against an already-running preview.
        command: "npm run preview -- --port 4173",
        port: 4173,
        reuseExistingServer: !isCI,
        timeout: 60 * 1000,
        stdout: "ignore",
        stderr: "pipe",
    },
});

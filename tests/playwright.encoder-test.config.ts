import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./encoder-test",
    outputDir: "./test-results/encoder-test",
    workers: 1,
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    timeout: 300_000,
    expect: { timeout: 15_000 },
    use: {
        channel: process.env.PW_CHANNEL || "chromium",
        headless: true,
        viewport: { width: 1100, height: 1000 },
        locale: "en-US",
        offline: true,
        serviceWorkers: "block",
        trace: "retain-on-failure",
    },
    reporter: [["list"]],
});

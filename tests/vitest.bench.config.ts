// Separate config for micro-bench (vitest bench), apart from the app-level
// vitest setup in vite.config.ts, so `npm run test` stays unaware of benches
// and `npm run test:bench` only picks up .bench.ts files.
//
// Node environment - parsers operate on byte buffers, no DOM/File needed.
// We wrap real files from private/samples via the node:buffer
// File polyfill (available in Node 20+) where the contract demands a Blob.
// Browser-specific layers (Web Workers, MediaSource, WebGL) are NOT
// covered here - that's the Playwright suite.

/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.bench.ts"],
        // Shared disk IO and CPU require serial runs for comparable timings.
        pool: "forks",
        fileParallelism: false,
        // A comparison includes repeated warmups and every available vendor.
        testTimeout: 0,
        reporters: ["default", "json"],
        // Preserve each run separately to compare the reported benchmarks.
        outputFile: { json: "private/perf-results/bench-latest.json" },
        benchmark: {
            include: ["src/**/*.bench.ts"],
        },
    },
});

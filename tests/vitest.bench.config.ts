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
        // Run benches serially - they share disk IO and CPU; concurrent runs
        // would pollute each other's numbers. Vitest 4 removed
        // poolOptions.forks.singleFork; the top-level fileParallelism:false is
        // the replacement (forces maxWorkers=1, files run one at a time).
        pool: "forks",
        fileParallelism: false,
        benchmark: {
            include: ["src/**/*.bench.ts"],
            // JSON output for diff between runs via `--compare <path>`.
            outputJson: "private/perf-results/bench-latest.json",
        },
    },
});

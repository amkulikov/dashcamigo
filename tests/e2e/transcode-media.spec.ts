import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rolldown } from "rolldown";
import { expect, REPO_ROOT, test } from "./_fixtures.js";
import type { runTranscodeRegression } from "../helpers/transcode-harness.js";

let harness: string;
// The cancel case intentionally exercises the pipeline's logged abort path.
test.use({ tolerateConsole: [/\[transcode:split\] split transcode aborted or failed.*AbortError: aborted/] });
test.beforeAll(async () => {
    const bundle = await rolldown({
        input: resolve(REPO_ROOT, "tests/helpers/transcode-harness.ts"),
        platform: "browser",
        resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
        transform: { define: { "import.meta.env": "{}" } },
    });
    try {
        const output = await bundle.generate({ format: "es", codeSplitting: false });
        const chunk = output.output.find((entry) => entry.type === "chunk");
        if (!chunk) throw new Error("transcode harness bundle missing");
        harness = chunk.code;
    } finally {
        await bundle.close();
    }
});

test.beforeEach(async ({ page }) => {
    await page.route("**/transcode-harness.js", (route) =>
        route.fulfill({ contentType: "application/javascript", body: harness }),
    );
    await page.route("**/transcode-harness.html", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Transcode regression</title>" }),
    );
    await page.goto("/transcode-harness.html");
});

for (const kind of ["split", "single-ts", "split-ts", "split-large", "cancel"] as const) {
    test(`transcode ${kind} releases decoders and preserves the media timeline`, async ({ page }) => {
        test.setTimeout(120_000);
        const fixture = kind.endsWith("-ts") ? "juscar/real-anonymized.TS" : "generic/clip-h264.mkv";
        const bytes = Array.from(readFileSync(resolve(REPO_ROOT, "src/parsers/__fixtures__", fixture)));
        const result = await page.evaluate(
            async ({ bytes, kind }) => {
                const url = "/transcode-harness.js";
                const module: { runTranscodeRegression: typeof runTranscodeRegression } = await import(url);
                return module.runTranscodeRegression(bytes, kind);
            },
            { bytes, kind },
        );
        test.skip(!result.supported, "WebCodecs High-profile H.264 encode not available on this platform");
        if (!result.supported) throw new Error("encoder capability check inconsistent");
        expect(result.decoded, "real video frames are decoded").toBeGreaterThan(0);
        expect(result.unclosedFrames, "all decoded frames are closed before the pipeline settles").toBe(0);
        expect(result.cancelled).toBe(kind === "cancel");
        if (result.cancelled) return;
        expect(result.resultFrames).toBeGreaterThan(0);
        expect(result.reportedBytes).toBe(result.actualBytes);
        expect(result.actualBytes).toBeGreaterThan(1024);
        if (kind === "split-large") expect(result.actualBytes).toBeGreaterThan(4 * 1024 * 1024);
        if (kind.endsWith("-ts")) {
            expect(result.audioStart, "TS audio is retained").not.toBeNull();
            expect(result.audioStart!).toBeCloseTo(0, 5);
            expect(result.audioEnd!).toBeGreaterThan(result.sourceDuration - 0.1);
            expect(result.videoEnd).toBeGreaterThan(result.sourceDuration - 0.1);
            expect(result.videoEnd).toBeLessThan(result.sourceDuration + 0.1);
            expect(result.videoStart).toBeLessThan(0.1);
            if (kind === "single-ts") expect(result.videoStart).toBeCloseTo(result.sourceVideoStart, 2);
        }
    });
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { makeTests, TEST_TIMEOUT_MS, type TestResult } from "../../scripts/encoder-test/shared.js";

const file = pathToFileURL(resolve("dist-diagnostics/dashcamigo-encoder-test.html")).href;

interface DownloadedReport {
    status: string;
    environment: { protocol: string; secureContext: boolean };
    results: TestResult[];
    tests: unknown[];
}

async function downloadReport(page: Page): Promise<DownloadedReport> {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^dashcamigo-encoder-report-.*\.json$/);
    await saved.saveAs(test.info().outputPath("report.json"));
    const text = await readFile((await saved.path())!, "utf8");
    expect(text).not.toContain("file:///");
    expect(text).not.toContain("/Users/");
    return JSON.parse(text) as DownloadedReport;
}

test("runs real encoders offline from a file URL and downloads measured evidence", async ({ page, context }, info) => {
    const requests: string[] = [];
    const errors: string[] = [];
    context.on("request", (request) => {
        if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route(/^https?:/, (route) => route.abort());
    await page.goto(file);
    await expect(page.getByRole("button", { name: "Download report" })).toBeDisabled();
    await page.screenshot({ path: info.outputPath("ready.png"), fullPage: true });
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run again" })).toBeEnabled({ timeout: 240_000 });
    const report = await downloadReport(page);
    expect(report.status).toBe("completed");
    expect(report.environment.protocol).toBe("file:");
    expect(report.environment.secureContext).toBe(true);
    expect(report.results).toHaveLength(makeTests().length);
    const completed = report.results.filter((result) => result.status === "completed");
    expect(completed.some((result) => result.test.pipeline === "webcodecs")).toBe(true);
    expect(completed.some((result) => result.test.pipeline === "mediabunny")).toBe(true);
    for (const result of report.results) {
        expect(["completed", "unsupported"], `${result.test.id}: ${result.error ?? result.status}`).toContain(
            result.status,
        );
        if (result.status !== "completed") continue;
        expect(result.allFramesReceived, result.test.id).toBe(true);
        expect(result.stats.frames).toBe(result.test.fps * result.test.seconds);
        expect(result.stats.bytes).toBeGreaterThan(0);
        expect(result.stats.keyframes).toBeGreaterThanOrEqual(3);
        expect(result.stats.decoderConfigs.length).toBeGreaterThan(0);
        expect(result.measuredBitrate).toBeGreaterThan(0);
        expect(result.requestedConfig?.bitrate).toBe(result.test.bitrate);
        expect(result.requestedConfig?.bitrateMode).toBe(result.test.bitrateMode);
        expect(result.support?.supported).toBe(true);
        expect(result.encodedSha256).toMatch(/^[a-f0-9]{64}$/);
        if (result.test.pipeline === "mediabunny") {
            expect(result.libraryConfigs).toHaveLength(1);
            expect(result.libraryConfigs[0]?.bitrate).toBe(result.test.bitrate);
            expect(result.libraryConfigs[0]?.codec).toBe(result.requestedConfig?.codec);
        }
    }
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("finished.png"), fullPage: true });
    await info.attach("report", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
});

test("keeps a downloadable report when worker WebCodecs is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
        const createObjectURL = URL.createObjectURL;
        URL.createObjectURL = (object) => {
            const blob =
                object instanceof Blob && object.type === "text/javascript"
                    ? new Blob(["globalThis.VideoEncoder = undefined;", object], { type: object.type })
                    : object;
            return createObjectURL(blob);
        };
    });
    await page.goto(file);
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("This browser could not finish");
    const report = await downloadReport(page);
    expect(report.results).toHaveLength(makeTests().length);
    expect(report.results.every((result) => result.status === "unsupported")).toBe(true);
    expect(report.results.every((result) => result.workerEnvironment?.videoEncoder === false)).toBe(true);
});

test("terminates a hung worker, continues testing, and saves cancellation evidence", async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        let calls = 0;
        window.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
                if (calls++ === 0) {
                    const wrapped = URL.createObjectURL(
                        new Blob(["onmessage = () => {};"], { type: "text/javascript" }),
                    );
                    super(wrapped, options);
                    URL.revokeObjectURL(wrapped);
                } else super(url, options);
            }
        };
    });
    await page.goto(file);
    await page.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Running test 1");
    await page.clock.fastForward(TEST_TIMEOUT_MS + 1);
    await expect(page.getByRole("status")).toContainText("Running test 2");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Test stopped");
    const report = await downloadReport(page);
    expect(report.status).toBe("stopped");
    expect(report.results[0]?.status).toBe("timeout");
    expect(report.results.at(-1)?.status).toBe("stopped");
    expect(report.results.length).toBeLessThan(report.tests.length);
});

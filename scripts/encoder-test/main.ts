import { collectGraphicsDiagnostics } from "../../src/graphics-diagnostics.js";
import {
    errorMessage,
    initialResult,
    makeTests,
    SCENE_VERSION,
    TEST_TIMEOUT_MS,
    testLabel,
    TOOL_VERSION,
    type TestCase,
    type TestResult,
    type WorkerMessage,
} from "./shared.js";

interface Report {
    tool: string;
    version: number;
    mediabunnyVersion: string;
    createdAt: string;
    finishedAt?: string;
    status: "running" | "completed" | "stopped" | "error";
    methodology: Record<string, unknown>;
    environment: Record<string, unknown>;
    tests: TestCase[];
    results: TestResult[];
    visibilityChanges: { elapsedMs: number; state: string }[];
    error?: string;
}

const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download")!;
const statusText = document.querySelector<HTMLElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const resultsBody = document.querySelector<HTMLTableSectionElement>("#results")!;
const rawReport = document.querySelector<HTMLElement>("#report")!;
let report: Report | undefined;
let running = false;
let stopped = false;
let runStarted = 0;
let cancelCurrent: (() => void) | undefined;

function refresh(): void {
    if (!report) return;
    rawReport.textContent = JSON.stringify(report, null, 2);
    resultsBody.replaceChildren();
    for (const result of report.results) {
        const row = document.createElement("tr");
        const cells = [
            testLabel(result.test),
            result.status,
            result.measuredBitrate === undefined ? "—" : `${(result.measuredBitrate / 1e6).toFixed(2)} Mbps`,
            `${result.stats.frames} / ${Math.round(result.test.fps * result.test.seconds)}`,
        ];
        for (const text of cells) {
            const cell = document.createElement("td");
            cell.textContent = text;
            row.append(cell);
        }
        resultsBody.append(row);
    }
}

async function browserDetails(): Promise<Record<string, unknown>> {
    interface NavigatorWithHints extends Navigator {
        userAgentData?: {
            getHighEntropyValues: (hints: string[]) => Promise<unknown>;
        };
    }
    const data = (navigator as NavigatorWithHints).userAgentData;
    if (!data) return { available: false };
    try {
        const values = await Promise.race([
            data.getHighEntropyValues(["architecture", "bitness", "platform", "platformVersion", "fullVersionList"]),
            new Promise((_, reject) => setTimeout(() => reject(new Error("browser details timed out")), 2000)),
        ]);
        return { available: true, values };
    } catch (error) {
        return { available: true, error: errorMessage(error) };
    }
}

function runOne(test: TestCase, index: number): Promise<void> {
    return new Promise((resolve) => {
        let result = initialResult(test);
        let worker: Worker | undefined;
        let url: string | undefined;
        let done = false;
        const start = performance.now();
        const finish = (status?: TestResult["status"], error?: string) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            worker?.terminate();
            if (url) URL.revokeObjectURL(url);
            cancelCurrent = undefined;
            if (status) result.status = status;
            if (error) result.error = error;
            result.elapsedMs = Math.round(performance.now() - start);
            report!.results[index] = result;
            progress.value = index + 1;
            refresh();
            resolve();
        };
        const timeout = setTimeout(
            () => finish("timeout", "test exceeded time limit; worker terminated"),
            TEST_TIMEOUT_MS,
        );
        cancelCurrent = () => finish("stopped", "stopped by user; worker terminated");
        report!.results[index] = result;
        refresh();
        try {
            const base64 = document.querySelector<HTMLElement>("#worker-source")!.textContent!.trim();
            const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
            url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
            worker = new Worker(url);
            worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
                if (done) return;
                result = event.data.result;
                report!.results[index] = result;
                if (event.data.type === "done") finish();
                else {
                    progress.value = index + result.submittedFrames / (test.seconds * test.fps);
                    refresh();
                }
            };
            worker.onerror = (event) => finish("error", event.message || "worker failed to start");
            worker.onmessageerror = () => finish("error", "worker message could not be read");
            worker.postMessage(test);
        } catch (error) {
            finish("error", errorMessage(error));
        }
    });
}

async function start(): Promise<void> {
    if (running) return;
    running = true;
    stopped = false;
    runStarted = performance.now();
    runButton.disabled = true;
    stopButton.disabled = false;
    downloadButton.disabled = false;
    const tests = makeTests();
    progress.max = tests.length;
    progress.value = 0;
    report = {
        tool: "everydashcam encoder diagnostic",
        version: TOOL_VERSION,
        mediabunnyVersion: document.querySelector<HTMLMetaElement>('meta[name="mediabunny-version"]')!.content,
        createdAt: new Date().toISOString(),
        status: "running",
        methodology: {
            scene: SCENE_VERSION,
            source: "deterministic synthetic moving texture; no recordings, audio, or decoding",
            rate: "encoded video packet bytes * 8 / packet timestamp span; excludes MP4 overhead",
            missingDuration: "falls back to the nominal frame duration; counted in missingDurations",
            hash: "SHA-256 of concatenated encoded video packets; excludes MP4 and decoder configuration",
            comparison:
                "compare bitrates within the same pipeline, resolution, fps, codec profile/level, mode, and acceleration preference",
            codec: "fixed H.264 profile/level within each pair; High profile plus separate Baseline software controls",
            isolation: "fresh encoder and dedicated worker per test",
            timeoutMs: TEST_TIMEOUT_MS,
            caveats: [
                "A supported configuration does not guarantee that the encoder meets the target bitrate.",
                "VBR can use less or more than the target, depending on the scene and short clip duration.",
                "Hardware acceleration is a preference, not proof of the implementation used.",
                "The WebGL renderer identifies graphics hardware, not the video encoder or driver version.",
                "libraryConfigs are Mediabunny candidate configurations, not encoder implementation metadata.",
                "Synthetic results do not reproduce all recording, decoding, or composition conditions.",
                "A completed test means the API calls finished, not that bitrate or quality passed.",
            ],
        },
        environment: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency,
            secureContext: isSecureContext,
            protocol: location.protocol,
            initialVisibility: document.visibilityState,
            worker: typeof Worker !== "undefined",
            videoEncoder: typeof VideoEncoder !== "undefined",
            videoFrame: typeof VideoFrame !== "undefined",
            offscreenCanvas: typeof OffscreenCanvas !== "undefined",
            graphics: collectGraphicsDiagnostics(),
        },
        tests,
        results: [],
        visibilityChanges: [],
    };
    refresh();
    statusText.textContent = "Getting ready…";
    try {
        report.environment.browserDetails = await browserDetails();
        for (const [index, test] of tests.entries()) {
            if (stopped) break;
            statusText.textContent = `Running test ${index + 1} of ${tests.length}. Keep this tab open.`;
            await runOne(test, index);
        }
        report.status = stopped ? "stopped" : "completed";
        const completed = report.results.filter((result) => result.status === "completed").length;
        if (stopped) statusText.textContent = "Test stopped. You can download the partial report and send it back.";
        else if (completed === 0)
            statusText.textContent =
                "This browser could not finish the tests. Download the report and send it back — it includes the details.";
        else statusText.textContent = "Report ready. Click Download report and attach the file to your reply.";
    } catch (error) {
        report.status = "error";
        report.error = errorMessage(error);
        statusText.textContent =
            "The test could not finish. Download the report and send it back so we can check what happened.";
    } finally {
        report.finishedAt = new Date().toISOString();
        running = false;
        runButton.disabled = false;
        runButton.textContent = "Run again";
        stopButton.disabled = true;
        refresh();
    }
}

runButton.addEventListener("click", () => void start());
stopButton.addEventListener("click", () => {
    stopped = true;
    stopButton.disabled = true;
    cancelCurrent?.();
});
document.addEventListener("visibilitychange", () => {
    if (running)
        report?.visibilityChanges.push({
            elapsedMs: Math.round(performance.now() - runStarted),
            state: document.visibilityState,
        });
});
downloadButton.addEventListener("click", () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashcamigo-encoder-report-${report.createdAt.replaceAll(":", "-").replace(/\.\d+Z$/, "Z")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

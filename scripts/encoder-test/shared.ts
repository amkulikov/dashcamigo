export const TOOL_VERSION = 1;
export const TEST_TIMEOUT_MS = 60_000;
export const SCENE_VERSION = "moving-texture-1";

export interface TestCase {
    id: string;
    pipeline: "webcodecs" | "mediabunny";
    width: number;
    height: number;
    fps: number;
    seconds: number;
    bitrate: number;
    bitrateMode: "variable" | "constant";
    hardwareAcceleration: "no-preference" | "prefer-software";
    codec: string;
}

export interface PacketStats {
    frames: number;
    keyframes: number;
    bytes: number;
    firstTimestampUs: number | null;
    lastEndTimestampUs: number | null;
    missingDurations: number;
    bytesPerSecond: number[];
    decoderConfigs: Record<string, unknown>[];
}

export interface TestResult {
    test: TestCase;
    status: "running" | "completed" | "unsupported" | "error" | "timeout" | "stopped";
    phase: string;
    submittedFrames: number;
    elapsedMs: number;
    support?: VideoEncoderSupport;
    requestedConfig?: VideoEncoderConfig;
    libraryConfigs: VideoEncoderConfig[];
    stats: PacketStats;
    measuredBitrate?: number;
    targetRatio?: number;
    allFramesReceived?: boolean;
    encodedSha256?: string;
    hashError?: string;
    error?: string;
    workerEnvironment?: Record<string, unknown>;
}

export interface WorkerMessage {
    type: "progress" | "done";
    result: TestResult;
}

export function makeTests(): TestCase[] {
    const tests: TestCase[] = [];
    const pair = (options: Partial<TestCase>) => {
        for (const bitrate of [5_000_000, 32_000_000]) {
            const test: TestCase = {
                id: "",
                pipeline: "webcodecs",
                width: 3840,
                height: 2160,
                fps: 25,
                seconds: 5,
                bitrate,
                bitrateMode: "variable",
                hardwareAcceleration: "no-preference",
                codec: "avc1.640033",
                ...options,
            };
            test.id = `${test.pipeline}-${test.height}p${test.fps}-${test.codec}-${test.bitrateMode}-${test.hardwareAcceleration}-${bitrate}`;
            tests.push(test);
        }
    };
    for (const pipeline of ["webcodecs", "mediabunny"] as const) {
        for (const bitrateMode of ["variable", "constant"] as const) pair({ pipeline, bitrateMode });
    }
    pair({ hardwareAcceleration: "prefer-software" });
    // Some software encoders only expose Baseline; compare its bitrates in a separate pair.
    pair({ hardwareAcceleration: "prefer-software", codec: "avc1.420033" });
    pair({ width: 1920, height: 1080, codec: "avc1.640029" });
    pair({ fps: 30 });
    return tests;
}

export function initialResult(test: TestCase): TestResult {
    return {
        test,
        status: "running",
        phase: "starting worker",
        submittedFrames: 0,
        elapsedMs: 0,
        libraryConfigs: [],
        stats: {
            frames: 0,
            keyframes: 0,
            bytes: 0,
            firstTimestampUs: null,
            lastEndTimestampUs: null,
            missingDurations: 0,
            bytesPerSecond: [],
            decoderConfigs: [],
        },
    };
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function testLabel(test: TestCase): string {
    return `${test.pipeline === "webcodecs" ? "WebCodecs" : "Mediabunny"} · ${test.height}p / ${test.fps} fps · ${test.bitrate / 1e6} Mbps · ${test.bitrateMode === "variable" ? "VBR" : "CBR"}${test.hardwareAcceleration === "prefer-software" ? " · prefer software" : ""}${test.codec.startsWith("avc1.42") ? " · Baseline" : ""}`;
}

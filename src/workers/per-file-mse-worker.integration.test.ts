import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { BufferSource, EncodedPacketSink, Input } from "mediabunny";
import { rolldown } from "rolldown";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMseFixture } from "../../tests/helpers/mse-fixtures.js";
import { VIDEO_INPUT_FORMATS } from "../video-formats.js";
import { isWireMessage, type WireMessage, type WireNotification } from "./_protocol/wire.js";
import type { MediaSegmentNotificationData } from "./per-file-mse-protocol.js";

let tempDirectory: string;
const workers: Worker[] = [];

beforeAll(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "dashcamigo-mse-test-"));
    const bundle = await rolldown({
        input: fileURLToPath(new URL("./per-file-mse-worker.ts", import.meta.url)),
        platform: "node",
        transform: { define: { "import.meta.env.DEV": "false" } },
    });
    try {
        await bundle.write({ file: join(tempDirectory, "worker.mjs"), format: "esm" });
    } finally {
        await bundle.close();
    }
    await writeFile(
        join(tempDirectory, "endpoint.mjs"),
        `import { parentPort } from "node:worker_threads";
        globalThis.self = {
            postMessage(message, transfer) { parentPort.postMessage(message, transfer); },
            addEventListener(type, listener) {
                if (type === "message") parentPort.on("message", data => listener({ data }));
            }
        };
        await import("./worker.mjs");
        parentPort.postMessage({ __k: "ntf", type: "ready" });`,
    );
});

afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

afterAll(async () => {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

async function openWorker(bytes: Uint8Array<ArrayBuffer>, startSec = 0) {
    const worker = new Worker(pathToFileURL(join(tempDirectory, "endpoint.mjs")));
    workers.push(worker);
    const events: WireMessage[] = [];
    const listeners = new Set<() => void>();
    let failure: Error | null = null;
    worker.on("message", (message: unknown) => {
        if (!isWireMessage(message)) return;
        events.push(message);
        for (const listener of listeners) listener();
    });
    worker.on("error", (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        for (const listener of listeners) listener();
    });
    const waitFor = (predicate: () => boolean): Promise<void> =>
        new Promise((resolve, reject) => {
            const finish = () => {
                const errorMessage = events.find((event) => event.__k === "ntf" && event.type === "error");
                if (failure || errorMessage) {
                    cleanup();
                    reject(failure ?? new Error(JSON.stringify(errorMessage)));
                } else if (predicate()) {
                    cleanup();
                    resolve();
                }
            };
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error("worker did not produce the expected media"));
            }, 5000);
            const cleanup = () => {
                clearTimeout(timeout);
                listeners.delete(finish);
            };
            listeners.add(finish);
            finish();
        });
    const media = (cycleId: number) =>
        events.filter(
            (event): event is WireNotification =>
                event.__k === "ntf" &&
                event.type === "media-segment" &&
                (event.data as MediaSegmentNotificationData).cycleId === cycleId,
        );
    const send = (type: string, data: unknown) => worker.postMessage({ __k: "ntf", type, data });
    await waitFor(() => events.some((event) => event.__k === "ntf" && event.type === "ready"));
    worker.postMessage({ __k: "req", id: 1, type: "init", data: { file: new Blob([bytes]), startSec } });
    await waitFor(() => events.some((event) => event.__k === "res"));
    const init = events.find((event) => event.__k === "res");
    expect(init).toMatchObject({ ok: true });
    send("start-feed", { cycleId: 0 });
    return { events, waitFor, media, send, init };
}

async function readCycle(events: WireMessage[], cycleId: number) {
    const chunks = events.flatMap((event) => {
        if (event.__k !== "ntf" || !["init-segment", "media-segment"].includes(event.type)) return [];
        const data = event.data as MediaSegmentNotificationData;
        return data.cycleId === cycleId ? [data.bytes] : [];
    });
    const input = new Input({ source: new BufferSource(Buffer.concat(chunks)), formats: VIDEO_INPUT_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error("worker output has no video");
        const sink = new EncodedPacketSink(track);
        return { first: await sink.getFirstPacket(), duration: await input.computeDuration([track]) };
    } finally {
        input.dispose();
    }
}

describe("per-file MSE worker with real encoded packets", () => {
    it("emits the first fragment when the GOP exceeds the buffer-ahead window", async () => {
        const harness = await openWorker(await createMseFixture({ gopDurationSec: 10, gopCount: 3 }));
        await harness.waitFor(() => harness.media(0).length > 0);
        const output = await readCycle(harness.events, 0);
        expect(output.first?.timestamp).toBeCloseTo(0);
        expect(output.duration).toBeCloseTo(10);
    });

    it("emits a full video GOP when leading audio flushes earlier fragments", async () => {
        const harness = await openWorker(
            await createMseFixture({
                gopDurationSec: 10,
                gopCount: 3,
                audioDurationSec: 30,
                audioLeadSec: 1024 / 48000,
            }),
        );
        expect(harness.init).toMatchObject({ result: { hasAudio: true } });
        await harness.waitFor(() =>
            harness
                .media(0)
                .some((event) => (event.data as MediaSegmentNotificationData).videoKeyframeTimestamps.length > 0),
        );
        const output = await readCycle(harness.events, 0);
        expect(output.first?.timestamp).toBeCloseTo(1024 / 48000, 3);
        expect(output.duration).toBeGreaterThanOrEqual(10);
    });

    it("keeps video playable when audio ends substantially earlier", async () => {
        const harness = await openWorker(await createMseFixture({ audioDurationSec: 0.4 }));
        expect(harness.init).toMatchObject({ result: { hasAudio: false } });
        await harness.waitFor(() => harness.media(0).length >= 5);
        const output = await readCycle(harness.events, 0);
        expect(output.duration).toBeGreaterThanOrEqual(5);
    });

    it("preserves matched audio despite ordinary codec padding differences", async () => {
        const harness = await openWorker(await createMseFixture({ gopCount: 2, audioDurationSec: 2 }));
        expect(harness.init).toMatchObject({ result: { hasAudio: true } });
        await harness.waitFor(() => harness.events.some((event) => event.__k === "ntf" && event.type === "feed-done"));
        expect((await readCycle(harness.events, 0)).duration).toBeCloseTo(2);
    });

    it("keeps TS playback and seeks on the same zero-based timeline", async () => {
        const harness = await openWorker(await createMseFixture({ format: "mpegts", sourceOffsetSec: 1.4 }));
        await harness.waitFor(() => harness.media(0).length >= 6);
        expect((await readCycle(harness.events, 0)).first?.timestamp).toBeCloseTo(0);
        harness.send("seek", { cycleId: 1, startSec: 5 });
        await harness.waitFor(() => harness.media(1).length > 0);
        expect((await readCycle(harness.events, 1)).first?.timestamp).toBeCloseTo(5);
        harness.send("seek", { cycleId: 2, startSec: 0.5 });
        await harness.waitFor(() => harness.media(2).length > 0);
        expect((await readCycle(harness.events, 2)).first?.timestamp).toBeCloseTo(0);
    });

    it("preserves a positive MP4 composition offset", async () => {
        const harness = await openWorker(await createMseFixture({ sourceOffsetSec: 1.4 }));
        await harness.waitFor(() => harness.media(0).length > 0);
        expect((await readCycle(harness.events, 0)).first?.timestamp).toBeCloseTo(1.4);
    });
});

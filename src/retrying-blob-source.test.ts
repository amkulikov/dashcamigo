import { describe, expect, it, vi } from "vitest";

import { createReaderPool, createRetryingRangeStream, readRangeWithRetry } from "./retrying-blob-source.js";

// Only the environment boundary is faked: a Blob whose slice().stream() we
// script per call, so failures can be injected exactly where a scanner lock
// would land. The unit under test (retry loop, offset continuation, reader
// pooling, abort) is real.
interface SliceCall {
    start: number;
    end: number | undefined;
}

// Builds a Blob-shaped fake over `bytes`. `failAtCall` maps the 1-based slice
// call number to the count of chunk reads to serve before erroring with `err`.
// Chunks are served `chunkSize` bytes at a time.
function scriptedBlob(opts: {
    bytes: Uint8Array;
    chunkSize: number;
    failAtCall?: Map<number, { afterChunks: number; err: unknown }>;
}): { blob: Blob; sliceCalls: SliceCall[] } {
    const sliceCalls: SliceCall[] = [];
    const blob = {
        size: opts.bytes.length,
        slice(start: number, end?: number) {
            sliceCalls.push({ start, end });
            const callNo = sliceCalls.length;
            const failure = opts.failAtCall?.get(callNo);
            const stop = end ?? opts.bytes.length;
            let served = 0;
            let pos = start;
            return {
                stream: () =>
                    new ReadableStream<Uint8Array>({
                        pull: (controller) => {
                            if (failure && served >= failure.afterChunks) {
                                throw failure.err;
                            }
                            if (pos >= stop) {
                                controller.close();
                                return;
                            }
                            const next = Math.min(pos + opts.chunkSize, stop);
                            controller.enqueue(opts.bytes.slice(pos, next));
                            pos = next;
                            served++;
                        },
                    }),
            };
        },
    } as unknown as Blob;
    return { blob, sliceCalls };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

function sampleBytes(len: number): Uint8Array {
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = i % 251;
    return b;
}

const readErr = (): TypeError => new TypeError("network error");

describe("createRetryingRangeStream", () => {
    it("yields exactly the requested range from a single tail slice", async () => {
        const bytes = sampleBytes(1000);
        const { blob, sliceCalls } = scriptedBlob({ bytes, chunkSize: 64 });

        const got = await readAll(createRetryingRangeStream(blob, createReaderPool(), 100, 900, undefined));

        expect(got).toEqual(bytes.slice(100, 900));
        expect(sliceCalls).toEqual([{ start: 100, end: undefined }]);
    });

    it("consecutive ranges share one pooled reader (no re-slice, leftover carried over)", async () => {
        const bytes = sampleBytes(1000);
        // 64 does not divide 500: the first range ends mid-chunk, so the pooled
        // reader carries leftover bytes into the second range.
        const { blob, sliceCalls } = scriptedBlob({ bytes, chunkSize: 64 });
        const pool = createReaderPool();

        const first = await readAll(createRetryingRangeStream(blob, pool, 0, 500, undefined));
        const second = await readAll(createRetryingRangeStream(blob, pool, 500, 1000, undefined));

        expect(first).toEqual(bytes.slice(0, 500));
        expect(second).toEqual(bytes.slice(500, 1000));
        expect(sliceCalls, "the sequential fast path opens exactly one reader").toHaveLength(1);
    });

    // Timing (the backoff) is part of what's under test - fake timers.
    it("retries a transient read failure from the exact byte where it stopped", async () => {
        vi.useFakeTimers();
        try {
            const bytes = sampleBytes(1000);
            // First slice serves 3 chunks of 64 B then dies; second succeeds.
            const { blob, sliceCalls } = scriptedBlob({
                bytes,
                chunkSize: 64,
                failAtCall: new Map([[1, { afterChunks: 3, err: readErr() }]]),
            });

            const pending = readAll(createRetryingRangeStream(blob, createReaderPool(), 0, 1000, undefined));
            await vi.advanceTimersByTimeAsync(10_000);
            const got = await pending;

            expect(got).toEqual(bytes);
            expect(sliceCalls, "the re-slice continues at the delivered offset").toEqual([
                { start: 0, end: undefined },
                { start: 192, end: undefined },
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("gives each independent hiccup the full retry budget (counter resets on progress)", async () => {
        vi.useFakeTimers();
        try {
            const bytes = sampleBytes(1000);
            // Calls 1..3: one incident burning two retries; call 4 makes
            // progress (counter resets) then dies; call 5 finishes.
            const { blob, sliceCalls } = scriptedBlob({
                bytes,
                chunkSize: 100,
                failAtCall: new Map([
                    [1, { afterChunks: 2, err: readErr() }],
                    [2, { afterChunks: 0, err: readErr() }],
                    [3, { afterChunks: 0, err: readErr() }],
                    [4, { afterChunks: 1, err: readErr() }],
                ]),
            });

            const pending = readAll(createRetryingRangeStream(blob, createReaderPool(), 0, 1000, undefined));
            await vi.advanceTimersByTimeAsync(60_000);
            const got = await pending;

            expect(got).toEqual(bytes);
            expect(sliceCalls).toHaveLength(5);
        } finally {
            vi.useRealTimers();
        }
    });

    it("rethrows the original error once the consecutive-retry budget is spent", async () => {
        vi.useFakeTimers();
        try {
            const bytes = sampleBytes(100);
            const original = readErr();
            const always = new Map(
                Array.from({ length: 10 }, (_, i) => [i + 1, { afterChunks: 0, err: original }] as const),
            );
            const { blob, sliceCalls } = scriptedBlob({ bytes, chunkSize: 10, failAtCall: new Map(always) });

            const pending = readAll(createRetryingRangeStream(blob, createReaderPool(), 0, 100, undefined));
            pending.catch(() => {});
            await vi.advanceTimersByTimeAsync(60_000);

            await expect(pending).rejects.toBe(original);
            // Initial attempt + one per backoff step, then give up.
            expect(sliceCalls).toHaveLength(4);
        } finally {
            vi.useRealTimers();
        }
    });

    it("rethrows a non-read error immediately without retrying", async () => {
        const bytes = sampleBytes(100);
        const boom = new Error("unrelated bug");
        const { blob, sliceCalls } = scriptedBlob({
            bytes,
            chunkSize: 10,
            failAtCall: new Map([[1, { afterChunks: 0, err: boom }]]),
        });

        await expect(readAll(createRetryingRangeStream(blob, createReaderPool(), 0, 100, undefined))).rejects.toBe(
            boom,
        );
        expect(sliceCalls).toHaveLength(1);
    });

    it("readRangeWithRetry (the WebKit mode) retries a failed arrayBuffer read and returns exact bytes", async () => {
        vi.useFakeTimers();
        try {
            const bytes = sampleBytes(1000);
            const sliceCalls: SliceCall[] = [];
            let failuresLeft = 2;
            const blob = {
                size: bytes.length,
                slice(start: number, end?: number) {
                    sliceCalls.push({ start, end });
                    return {
                        arrayBuffer: async (): Promise<ArrayBuffer> => {
                            if (failuresLeft > 0) {
                                failuresLeft--;
                                throw readErr();
                            }
                            return bytes.slice(start, end).buffer as ArrayBuffer;
                        },
                    };
                },
            } as unknown as Blob;

            const pending = readRangeWithRetry(blob, 100, 900, undefined);
            await vi.advanceTimersByTimeAsync(10_000);
            const got = await pending;

            expect(got).toEqual(bytes.slice(100, 900));
            expect(sliceCalls, "a fresh slice per attempt").toEqual([
                { start: 100, end: 900 },
                { start: 100, end: 900 },
                { start: 100, end: 900 },
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a signal abort cuts a backoff wait short with AbortError", async () => {
        vi.useFakeTimers();
        try {
            const bytes = sampleBytes(100);
            const { blob } = scriptedBlob({
                bytes,
                chunkSize: 10,
                failAtCall: new Map([[1, { afterChunks: 0, err: readErr() }]]),
            });
            const controller = new AbortController();

            const pending = readAll(createRetryingRangeStream(blob, createReaderPool(), 0, 100, controller.signal));
            pending.catch(() => {});
            // Let the first failure land and the backoff start, then cancel.
            await vi.advanceTimersByTimeAsync(1);
            controller.abort();

            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            vi.useRealTimers();
        }
    });
});

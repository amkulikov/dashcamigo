// Bytes-read counter: wraps Blob.prototype.arrayBuffer/stream/text in the
// page context to count how many bytes the dashcamigo pipeline pulled off
// disk on the main thread. The key signal for IO-bound regressions on the
// main thread - parsers were designed to read 16 MB header + sparse seek
// instead of the full file.
//
// MAIN-THREAD ONLY. Workers (transcode, preview-generator, gps-extract) have
// their own Blob.prototype global that this script does not patch. They are
// the heavy IO path during ingest/export, so the counter SYSTEMATICALLY
// UNDERCOUNTS total disk reads. Treat the metric as "main-thread bytes
// requested", not "total IO load on the SD card". Worker IO needs a separate
// instrumentation channel (postMessage protocol or per-worker initScript via
// the worker constructor wrap) if we want full coverage.
//
// Installed via page.addInitScript so it patches the prototypes BEFORE any
// app code runs and before the first File is even created. Without that order
// any pre-existing File instances would still hold the original (uncounted)
// methods.
//
// Reset between scenarios by calling resetBytesRead(page) - sets the counter
// back to zero. Read via readBytesRead(page).

import type { Page } from "@playwright/test";

export const BYTES_READ_INIT_SCRIPT = `
(() => {
    const perf = (window.__dashcamigoPerf ||= {});
    perf.bytesRead = 0;

    // Instrument materializing methods on Blob (which File extends): only
    // arrayBuffer/stream/text actually pull bytes off disk; .slice creates a
    // virtual sub-Blob without IO. Counter measures REQUESTED bytes, not
    // unique bytes - if app code reads the same byte range twice via two
    // separate arrayBuffer() calls, both are counted. That is the metric
    // we want: it directly reflects IO load on the SD card.
    //
    // Defensive: 'this' is forced through Blob.prototype.[size] getter via
    // bind-safe check, so an unusual call shape like fn.call(notBlob) won't
    // throw. mediabunny / maplibre / chart.js use the normal blob.method()
    // shape.
    const safeSize = (b) => (b && typeof b === 'object' && typeof b.size === 'number') ? b.size : 0;

    const origArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
        perf.bytesRead += safeSize(this);
        return origArrayBuffer.call(this);
    };

    const origStream = Blob.prototype.stream;
    if (typeof origStream === 'function') {
        Blob.prototype.stream = function () {
            perf.bytesRead += safeSize(this);
            return origStream.call(this);
        };
    }

    const origText = Blob.prototype.text;
    Blob.prototype.text = function () {
        perf.bytesRead += safeSize(this);
        return origText.call(this);
    };
})();
`;

/**
 * Resets the bytes-read counter on the page. Call before each replay so the
 * count reflects exactly that scenario.
 */
export async function resetBytesRead(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __dashcamigoPerf?: { bytesRead?: number } };
        if (w.__dashcamigoPerf) w.__dashcamigoPerf.bytesRead = 0;
    });
}

/**
 * Reads the current bytes-read counter from the page. Returns 0 if the init
 * script was not installed or the counter is unset.
 */
export async function readBytesRead(page: Page): Promise<number> {
    return await page.evaluate(() => {
        const w = window as unknown as { __dashcamigoPerf?: { bytesRead?: number } };
        return w.__dashcamigoPerf?.bytesRead ?? 0;
    });
}

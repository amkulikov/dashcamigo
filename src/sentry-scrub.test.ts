// Tests for the Sentry PII scrubber. These guard the one network sink against
// leaking file names, paths, coordinates and blob URLs - the project's core
// "video never leaves your machine" promise. Pure functions, no DOM, node env.

import { describe, expect, it } from "vitest";
import { maskFilename, scrubBreadcrumb, scrubEvent, scrubMessage, scrubValue } from "./sentry-scrub.js";

describe("maskFilename", () => {
    it("keeps only the extension, drops the basename", () => {
        expect(maskFilename("Anna_birthday.MP4")).toBe("***.mp4");
        expect(maskFilename("NO20240115-143052-000123F.MP4")).toBe("***.mp4");
    });

    it("strips the directory part first", () => {
        expect(maskFilename("/Volumes/SD/Front/clip.MOV")).toBe("***.mov");
        expect(maskFilename("C:\\Users\\Ivan\\rear.ts")).toBe("***.ts");
    });

    it("returns *** when there is no usable extension", () => {
        expect(maskFilename("noextension")).toBe("***");
        expect(maskFilename("weird.toolongextension")).toBe("***");
    });
});

describe("scrubMessage", () => {
    it("masks embedded media file names", () => {
        expect(scrubMessage("no video track in file NO20240115-143052F.MP4")).toBe("no video track in file ***.mp4");
    });

    it("collapses absolute paths", () => {
        expect(scrubMessage("could not open C:\\Users\\Anna\\clip.mp4 now")).toContain("[path]");
        expect(scrubMessage("could not open C:\\Users\\Anna\\clip.mp4 now")).not.toContain("Anna");
        expect(scrubMessage("no moov in /Users/ivan/Movie/front.mp4")).toBe("no moov in [path]");
        expect(scrubMessage("/Volumes/SDCARD/DCIM/x.mov gone")).toBe("[path] gone");
    });

    it("redacts blob URLs and long digit runs", () => {
        expect(scrubMessage("load blob:https://dashcamigo.app/9f1c-2e7a failed")).toBe("load blob:[redacted] failed");
        expect(scrubMessage("serial 1234567890 mismatch")).toBe("serial # mismatch");
    });

    it("leaves a clean structural error message intact", () => {
        const msg = "DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed";
        expect(scrubMessage(msg)).toBe(msg);
    });

    it("masks a decimal coordinate pair", () => {
        expect(scrubMessage("near 50.4501, 30.5234 failed")).toBe("near [coords] failed");
        // Small decimals (crop rects, ratios) are NOT coordinates - left intact.
        expect(scrubMessage("ratio 1.5, 2.5 ok")).toBe("ratio 1.5, 2.5 ok");
    });

    it("truncates pathological lengths", () => {
        expect(scrubMessage("a".repeat(5000)).length).toBeLessThanOrEqual(1024);
    });
});

describe("scrubValue", () => {
    it("masks file/path keys, drops coordinates, keeps safe fields", () => {
        const out = scrubValue({
            file: "Anna.mp4",
            path: "/Users/anna/Front/clip.mp4",
            codec: "hev1.2.4.L150",
            lat: 50.4501,
            lon: 30.5234,
            count: 12,
            nested: { filename: "rear.mov", reason: "no-gpmd", latitude: 1.23 },
        }) as Record<string, unknown>;

        expect(out.file).toBe("***.mp4");
        expect(out.path).toBe("***.mp4");
        expect(out.codec).toBe("hev1.2.4.L150");
        expect(out.count).toBe(12);
        // Coordinate keys are dropped entirely.
        expect("lat" in out).toBe(false);
        expect("lon" in out).toBe(false);
        const nested = out.nested as Record<string, unknown>;
        expect(nested.filename).toBe("***.mov");
        expect(nested.reason).toBe("no-gpmd");
        expect("latitude" in nested).toBe(false);
    });

    it("tolerates circular references", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        expect(() => scrubValue(obj)).not.toThrow();
        const out = scrubValue(obj) as Record<string, unknown>;
        expect(out.a).toBe(1);
        expect(out.self).toBe("[circular]");
    });

    it("caps long arrays", () => {
        const big = Array.from({ length: 200 }, (_, i) => i);
        const out = scrubValue(big) as unknown[];
        expect(out.length).toBeLessThanOrEqual(51);
        expect(out[out.length - 1]).toContain("more");
    });

    it("scrubs free strings inside the structure", () => {
        const out = scrubValue({ note: "failed on /Users/x/a.mp4" }) as Record<string, unknown>;
        expect(out.note).toBe("failed on [path]");
    });

    // The *name* heuristic is substring-based on purpose, so diagnostic
    // identifiers must live under keys that do not match it (worker-client
    // tags `worker`, worker-pool logs `pool`). This pins both sides: the
    // masking stays broad AND the chosen diagnostic keys stay transparent.
    it("masks any *name*-key but keeps the renamed diagnostic keys", () => {
        const out = scrubValue({
            worker_name: "ingest-0",
            worker: "ingest-0",
            pool: "ingest",
            extractor: "freegps",
        }) as Record<string, unknown>;
        expect(out.worker_name).toBe("***");
        expect(out.worker).toBe("ingest-0");
        expect(out.pool).toBe("ingest");
        expect(out.extractor).toBe("freegps");
    });
});

describe("scrubEvent", () => {
    it("strips request query/headers/cookies", () => {
        const ev = {
            request: {
                url: "https://dashcamigo.app/ru/?ref=secret#frag",
                headers: { "User-Agent": "x", Referer: "y" },
                cookies: "a=b",
            },
        };
        scrubEvent(ev);
        expect(ev.request.url).toBe("https://dashcamigo.app/ru/");
        expect(ev.request.headers).toBeUndefined();
        expect(ev.request.cookies).toBeUndefined();
    });

    it("scrubs exception values, breadcrumbs and extra", () => {
        const ev = {
            exception: { values: [{ value: "decode failed for /Users/a/x.mp4" }] },
            breadcrumbs: [{ message: "open file Trip.MOV", data: { file: "Trip.MOV", lat: 1 } }],
            extra: { downloadName: "MyTrip.mp4", ok: true },
        };
        scrubEvent(ev);
        expect(ev.exception.values[0]!.value).toBe("decode failed for [path]");
        expect(ev.breadcrumbs[0]!.message).toBe("open file ***.mov");
        const bcData = ev.breadcrumbs[0]!.data as Record<string, unknown>;
        expect(bcData.file).toBe("***.mov");
        expect("lat" in bcData).toBe(false);
        const extra = ev.extra as Record<string, unknown>;
        expect(extra.downloadName).toBe("***.mp4");
        expect(extra.ok).toBe(true);
    });

    it("scrubs the fingerprint array (the one field the SDK sets before beforeSend)", () => {
        const ev = { fingerprint: ["worker_crash", "ingest", "/Users/a/clip.mp4"] };
        scrubEvent(ev);
        expect(ev.fingerprint).toEqual(["worker_crash", "ingest", "[path]"]);
    });

    it("keeps contexts.trace ids intact while still scrubbing sibling contexts", () => {
        // Hex ids routinely contain 8+ digit runs; the generic digit scrub would
        // mangle them into "#" and Sentry rejects the trace context as invalid.
        const ev = {
            contexts: {
                trace: { trace_id: "abc12345678def90123456789012cdef", span_id: "95144e4703021baf" },
                session: { file: "Trip.MOV" },
            },
        };
        scrubEvent(ev);
        const ctx = ev.contexts as Record<string, Record<string, unknown>>;
        expect(ctx.trace!.trace_id).toBe("abc12345678def90123456789012cdef");
        expect(ctx.trace!.span_id).toBe("95144e4703021baf");
        expect(ctx.session!.file).toBe("***.mov");
    });
});

describe("scrubBreadcrumb", () => {
    it("scrubs message and data in place", () => {
        const bc = { message: "indexing /Volumes/SD/clip.mp4", data: { name: "clip.mp4", coord: "50,30" } };
        scrubBreadcrumb(bc);
        expect(bc.message).toBe("indexing [path]");
        expect(bc.data.name).toBe("***.mp4");
        expect("coord" in bc.data).toBe(false);
    });

    it("keeps errKind readable - the logger sink's error-name key must not match the *name* mask", () => {
        // Regression: the sink used `errorName`, which FILENAME_KEY_RE matches
        // by the "name" substring - every Error breadcrumb arrived in Sentry
        // with its error name masked to "***" (same key-class bug as the
        // worker-client one fixed in 391e66b). The fix renamed the key; this
        // pins both directions so a rename-back fails loudly.
        const bc = { message: "x", data: { errKind: "TypeError", errorName: "TypeError" } };
        scrubBreadcrumb(bc);
        expect(bc.data.errKind).toBe("TypeError");
        expect(bc.data.errorName).toBe("***");
    });
});

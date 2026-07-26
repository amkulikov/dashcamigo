// Unit tests for HTML/XML escape - used in all popups/tooltips and GPX
// serialization. Single source of truth for the project, so we check the
// full set of transformations and edge cases.

import { describe, expect, it } from "vitest";

import { escapeHtml, escapeXml } from "./escape.js";

describe("escapeHtml", () => {
    it("escapes all 5 dangerous chars", () => {
        expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    it("escapes & first (avoid double-escape)", () => {
        // If order were "<" → "&lt;" then "&" → "&amp;", we'd get
        // "&amp;lt;" instead of "&lt;".
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    });

    it("passes through plain text unchanged", () => {
        expect(escapeHtml("hello world 123")).toBe("hello world 123");
    });

    it("passes through unicode unchanged (cyrillic / japanese)", () => {
        expect(escapeHtml("Привет 你好 こんにちは")).toBe("Привет 你好 こんにちは");
    });

    it("passes through emoji unchanged", () => {
        // Emoji are valid in HTML text nodes without escaping.
        expect(escapeHtml("✓ done 🎉")).toBe("✓ done 🎉");
    });

    it("handles empty string", () => {
        expect(escapeHtml("")).toBe("");
    });

    it("escapes XSS-like payload", () => {
        const xss = `<script>alert("x")</script>`;
        expect(escapeHtml(xss)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });

    it("escapes attribute injection attempt", () => {
        // typical attribute injection: `" onerror="alert(1)"`.
        expect(escapeHtml(`" onerror="alert(1)`)).toBe("&quot; onerror=&quot;alert(1)");
    });

    it("uses &#39; for single quote (not &apos; - that's XML-only)", () => {
        expect(escapeHtml("'")).toBe("&#39;");
        expect(escapeHtml("'")).not.toBe("&apos;");
    });

    it("coerces non-string via String()", () => {
        expect(escapeHtml(123 as unknown as string)).toBe("123");
        expect(escapeHtml(null as unknown as string)).toBe("null");
        expect(escapeHtml(undefined as unknown as string)).toBe("undefined");
    });

    it("escapes a dashcam filename with quotes safely", () => {
        // Real case: dashcam files can have unusual characters in their names.
        expect(escapeHtml(`NO20240115-120000-"FH".mp4`)).toBe(`NO20240115-120000-&quot;FH&quot;.mp4`);
    });
});

describe("escapeXml", () => {
    it("escapes all 5 dangerous chars with XML-style apos", () => {
        expect(escapeXml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&apos;");
    });

    it("differs from HTML on single quote (&apos; not &#39;)", () => {
        expect(escapeXml("'")).toBe("&apos;");
        expect(escapeHtml("'")).toBe("&#39;");
    });

    it("escapes & first (no double-escape)", () => {
        expect(escapeXml("&apos;")).toBe("&amp;apos;");
    });

    it("passes through plain ASCII", () => {
        expect(escapeXml("hello 123")).toBe("hello 123");
    });

    it("passes through unicode (used in GPX <name> for non-ASCII trip titles)", () => {
        expect(escapeXml("поездка №1")).toBe("поездка №1");
    });

    it("escapes XML CDATA-injection attempt", () => {
        // Attempt to close CDATA or inject an element.
        const payload = `]]><foo>`;
        expect(escapeXml(payload)).toBe("]]&gt;&lt;foo&gt;");
    });

    it("handles empty", () => {
        expect(escapeXml("")).toBe("");
    });
});

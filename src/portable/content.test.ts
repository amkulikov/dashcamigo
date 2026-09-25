import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePortableHtml } from "../../scripts/_portable-content.mjs";

function compressed(html: string): string {
    return `<!doctype html><script id="dc-portable-payload" type="application/gzip">${gzipSync(html).toString("base64")}</script>`;
}

describe("portable content inspection", () => {
    it("preserves legacy portable and hosted HTML without a payload element", () => {
        const html = '<!doctype html><html lang="ru"><script>const title="Карта 🚗";</script></html>';
        expect(decodePortableHtml(html)).toBe(html);
    });

    it("decodes the complete logical document with exact Unicode and line endings", () => {
        const html =
            '<!doctype html><html lang="ru"><style>body::before{content:"日本語 🚗"}</style>\r\n' +
            '<script type="application/json" id="dc-i18n">{"label":"Карта"}</script>' +
            '<a href="https://example.invalid/ru/">Open</a><script type="module">const text="<\\/script>";</script></html>';
        const outer = compressed(html);
        expect(outer).not.toContain("example.invalid");
        expect(decodePortableHtml(outer)).toBe(html);
    });

    it("reads reordered attributes and surrounding payload whitespace", () => {
        const html = "<!doctype html><title>Portable</title>";
        const encoded = gzipSync(html).toString("base64");
        expect(
            decodePortableHtml(
                `<script type='application/gzip' data-edition='portable' id='dc-portable-payload'>\n${encoded}\n</script>`,
            ),
        ).toBe(html);
    });

    it.each([
        '<div id="dc-portable-payload">missing script</div>',
        '<script id="dc-portable-payload" type="application/json">AAAA</script>',
        '<script id="dc-portable-payload" type="application/gzip"></script>',
        '<script id="dc-portable-payload" type="application/gzip">%%%invalid%%%</script>',
        '<script id="dc-portable-payload" type="application/gzip">AB==</script>',
        `${compressed("first")}${compressed("second")}`,
    ])("rejects malformed wrappers instead of silently treating them as legacy HTML: %s", (html) => {
        expect(() => decodePortableHtml(html)).toThrow();
    });

    it("rejects a truncated gzip stream and invalid decompressed UTF-8", () => {
        const gzip = gzipSync("valid HTML");
        const truncated = gzip.subarray(0, gzip.length - 4).toString("base64");
        expect(() =>
            decodePortableHtml(`<script id="dc-portable-payload" type="application/gzip">${truncated}</script>`),
        ).toThrow();
        const invalidUtf8 = gzipSync(Buffer.from([0xff])).toString("base64");
        expect(() =>
            decodePortableHtml(`<script id="dc-portable-payload" type="application/gzip">${invalidUtf8}</script>`),
        ).toThrow();
    });
});

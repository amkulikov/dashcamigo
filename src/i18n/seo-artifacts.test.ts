import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PRIMARY_ORIGIN = "https://primary.example";
const MIRROR_ORIGIN = "https://mirror.example";
const VALIDATOR = resolve("scripts/check-seo.mjs");
const directories: string[] = [];

interface DeploymentFixture {
    origin?: string;
    noIndex?: boolean;
    cutover?: boolean;
    emptySitemap?: boolean;
}

function makeArtifacts(options: DeploymentFixture = {}): Record<string, string> {
    const { origin = PRIMARY_ORIGIN, noIndex = false, cutover = false, emptySitemap = false } = options;
    const locales = [
        { lang: "en", origin: PRIMARY_ORIGIN },
        { lang: "ru", origin: cutover ? MIRROR_ORIGIN : PRIMARY_ORIGIN },
    ];
    const alternates = [...locales.map((locale) => [locale.lang, `${locale.origin}/${locale.lang}/`]), ["x-default", `${PRIMARY_ORIGIN}/en/`]];
    const htmlAlternates = alternates.map(([lang, url]) => `<link rel="alternate" hreflang="${lang}" href="${url}">`).join("");
    const xmlAlternates = alternates.map(([lang, url]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`).join("");
    const robots = noIndex ? '<meta name="robots" content="noindex, nofollow">' : "";
    const website = JSON.stringify({ "@type": "WebSite", url: `${origin}/` });
    const entries = emptySitemap
        ? ""
        : locales
              .filter((locale) => locale.origin === origin)
              .map((locale) => `<url><loc>${locale.origin}/${locale.lang}/</loc>${xmlAlternates}</url>`)
              .join("");
    const files: Record<string, string> = {
        "index.html": `<!doctype html><html><head>${robots}<script type="application/ld+json">${website}</script></head></html>`,
        _redirects: "/old /en/ 301\n",
        "asset.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
        "sitemap.xml": `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries}</urlset>`,
    };
    for (const locale of locales) {
        files[`${locale.lang}/index.html`] = `<!doctype html>
<html lang="${locale.lang}"><head>
<title>${locale.lang} title</title><meta name="description" content="description">
<link rel="canonical" href="${locale.origin}/${locale.lang}/">
${htmlAlternates}${robots}
<script type="application/ld+json">{"@type":"WebPage"}</script>
</head><body><h1>Title</h1><img src="/asset.svg" alt="preview"><a href="/${locale.lang}/">Home</a></body></html>`;
    }
    return files;
}

function validate(files: Record<string, string>): { status: number | null; output: string } {
    const directory = mkdtempSync(join(tmpdir(), "dashcamigo-seo-artifacts-"));
    directories.push(directory);
    for (const [path, contents] of Object.entries(files)) {
        const file = join(directory, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
    }
    const result = spawnSync(process.execPath, [VALIDATOR, directory], { encoding: "utf8", timeout: 10_000 });
    expect(result.error, "validator completes without process errors").toBeUndefined();
    return { status: result.status, output: result.stdout + result.stderr };
}

function replaceArtifact(files: Record<string, string>, path: string, oldValue: string, newValue: string): void {
    expect(files[path], `fixture contains ${path}`).toContain(oldValue);
    files[path] = files[path]!.replace(oldValue, newValue);
}

function expectRejected(files: Record<string, string>, message: string): void {
    const result = validate(files);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(message);
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SEO artifact deployment policies", () => {
    const policies: Array<DeploymentFixture & { label: string }> = [
        { label: "primary" },
        { label: "staging", noIndex: true },
        { label: "mirror canary", origin: MIRROR_ORIGIN, noIndex: true, emptySitemap: true },
        { label: "primary after cutover", cutover: true },
        { label: "mirror after cutover", origin: MIRROR_ORIGIN, cutover: true },
    ];

    it.each(policies)("accepts $label artifacts", (policy) => {
        const result = validate(makeArtifacts(policy));
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("[check-seo] OK");
    });
});

describe("SEO artifact regressions", () => {
    it("rejects a hreflang graph without matching return links", () => {
        const files = makeArtifacts();
        replaceArtifact(files, "ru/index.html", 'hreflang="en"', 'hreflang="de"');
        expectRejected(files, "hreflang graph differs");
    });

    it("rejects sitemap alternates that differ from the HTML", () => {
        const files = makeArtifacts();
        replaceArtifact(files, "sitemap.xml", 'hreflang="ru"', 'hreflang="de"');
        expectRejected(files, "sitemap and HTML hreflang differ");
    });

    it("rejects a missing local preview image", () => {
        const files = makeArtifacts();
        replaceArtifact(files, "en/index.html", "/asset.svg", "/missing.svg");
        expectRejected(files, "references missing local resource /missing.svg");
    });

    it("rejects an unsupported Cloudflare not-found rewrite", () => {
        const files = makeArtifacts();
        files._redirects += "/* /404.html 404\n";
        expectRejected(files, "unsupported Cloudflare redirect status");
    });

    it("rejects a redirect that covers an indexed canonical URL", () => {
        const files = makeArtifacts();
        files._redirects += "/en/ /ru/ 301\n";
        expectRejected(files, "sitemap URL matches a redirect or rewrite");
    });

    it("rejects malformed structured data", () => {
        const files = makeArtifacts();
        replaceArtifact(files, "en/index.html", '{"@type":"WebPage"}', "{broken");
        expectRejected(files, "invalid JSON-LD");
    });

    it("rejects accidental noindex on a production content page", () => {
        const files = makeArtifacts();
        replaceArtifact(files, "en/index.html", "<title>", '<meta name="robots" content="noindex"><title>');
        expectRejected(files, "noindex differs from the deployment policy");
    });
});

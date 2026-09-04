// Validate final artifacts, including changes introduced after HTML rendering.
// Deployment ownership comes from the output, so the same guard works for
// production, staging, mirrors and self-hosted builds without network access.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

const DIST = resolve(process.argv[2] ?? "dist");
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
}

function parseDocument(path, mimeType) {
    return new DOMParser({
        onError(level, message) {
            if (level !== "warning") throw new Error(`${relative(DIST, path)}: ${message}`);
        },
    }).parseFromString(readFileSync(path, "utf8"), mimeType);
}

function elements(node, tag) {
    return Array.from(node.getElementsByTagName(tag));
}

function metaValues(doc, name) {
    return elements(doc, "meta")
        .filter((node) => (node.getAttribute("name") ?? node.getAttribute("property"))?.toLowerCase() === name)
        .map((node) => node.getAttribute("content") ?? "");
}

function isNoIndex(doc) {
    return [...metaValues(doc, "robots"), ...metaValues(doc, "googlebot")].some((value) =>
        /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(value),
    );
}

function absoluteUrl(value, label) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label}: invalid absolute URL ${JSON.stringify(value)}`);
    }
    requireCondition(url.protocol === "https:" && !url.username && !url.password, `${label}: expected HTTPS URL`);
    requireCondition(!url.search && !url.hash, `${label}: canonical URLs cannot contain a query or fragment`);
    requireCondition(!/\.html$/i.test(url.pathname), `${label}: HTML URLs must use the extension-less form`);
    return url;
}

function alternateMap(nodes, label) {
    const result = new Map();
    for (const node of nodes) {
        if (node.getAttribute("rel") !== "alternate" || !node.hasAttribute("hreflang")) continue;
        const lang = node.getAttribute("hreflang").toLowerCase();
        requireCondition(lang && !result.has(lang), `${label}: duplicate or empty hreflang ${lang}`);
        const url = absoluteUrl(node.getAttribute("href"), `${label} hreflang ${lang}`);
        result.set(lang, url.href);
    }
    return result;
}

function sameAlternates(left, right) {
    return left.size === right.size && [...left].every(([lang, url]) => right.get(lang) === url);
}

function htmlFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith(".html") ? [path] : [];
    });
}

function isFile(path) {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function localFile(pathname) {
    const path = resolve(DIST, `.${decodeURIComponent(pathname)}`);
    requireCondition(path === DIST || path.startsWith(`${DIST}/`), `URL escapes the build directory: ${pathname}`);
    if (isFile(path)) return path;
    if (isFile(`${path}.html`)) return `${path}.html`;
    if (isFile(join(path, "index.html"))) return join(path, "index.html");
    return null;
}

function jsonLd(doc, label) {
    return elements(doc, "script")
        .filter((node) => node.getAttribute("type") === "application/ld+json")
        .flatMap((node) => {
            let data;
            try {
                data = JSON.parse(node.textContent);
            } catch {
                throw new Error(`${label}: invalid JSON-LD in ${node.getAttribute("id") || "script"}`);
            }
            requireCondition(
                data !== null && typeof data === "object",
                `${label}: JSON-LD must contain an object or array`,
            );
            const nodes = Array.isArray(data) ? data : (data["@graph"] ?? [data]);
            requireCondition(
                Array.isArray(nodes) && nodes.every((value) => value !== null && typeof value === "object"),
                `${label}: JSON-LD graph must contain objects`,
            );
            return nodes;
        });
}

function check() {
    const root = parseDocument(join(DIST, "index.html"), "text/html");
    const rootWebsite = jsonLd(root, "/").find((node) => node["@type"] === "WebSite");
    requireCondition(rootWebsite, "root redirect has no WebSite structured data");
    const origin = absoluteUrl(rootWebsite.url, "root WebSite").origin;
    const globalNoIndex = isNoIndex(root);
    const sitemap = parseDocument(join(DIST, "sitemap.xml"), "application/xml");
    requireCondition(
        sitemap.documentElement.localName === "urlset" && sitemap.documentElement.namespaceURI === SITEMAP_NS,
        "sitemap.xml must contain a urlset in the sitemap namespace",
    );
    const entries = new Map();
    for (const node of Array.from(sitemap.getElementsByTagNameNS(SITEMAP_NS, "url"))) {
        const locations = Array.from(node.getElementsByTagNameNS(SITEMAP_NS, "loc"));
        requireCondition(locations.length === 1, "sitemap entry must have exactly one loc");
        const url = absoluteUrl(locations[0].textContent.trim(), "sitemap loc");
        requireCondition(url.origin === origin, `sitemap contains an URL owned by another deployment: ${url.href}`);
        requireCondition(url.pathname !== "/", "sitemap includes the root redirect");
        requireCondition(!entries.has(url.href), `sitemap contains duplicate URL ${url.href}`);
        const alternates = alternateMap(Array.from(node.getElementsByTagNameNS(XHTML_NS, "link")), url.href);
        entries.set(url.href, { url, alternates });
    }
    requireCondition(entries.size > 0 || globalNoIndex, "indexable deployment has an empty sitemap");

    const pages = new Map();
    for (const file of htmlFiles(DIST)) {
        const name = relative(DIST, file);
        if (name === "index.html" || name === "404.html") continue;
        const route = `/${name.replace(/index\.html$/, "").replace(/\.html$/, "")}`;
        const doc = parseDocument(file, "text/html");
        const head = elements(doc, "head")[0];
        requireCondition(head, `${route}: missing head`);
        const links = elements(head, "link");
        const canonicals = links.filter((node) => node.getAttribute("rel") === "canonical");
        requireCondition(canonicals.length === 1, `${route}: expected exactly one canonical`);
        const canonical = absoluteUrl(canonicals[0].getAttribute("href"), `${route} canonical`);
        requireCondition(canonical.pathname === route, `${route}: canonical points at another route ${canonical.href}`);
        requireCondition(
            elements(head, "title").length === 1 && elements(head, "title")[0].textContent.trim(),
            `${route}: missing or duplicate title`,
        );
        const descriptions = metaValues(head, "description");
        requireCondition(
            descriptions.length === 1 && descriptions[0].trim(),
            `${route}: missing or duplicate description`,
        );
        requireCondition(doc.documentElement.getAttribute("lang"), `${route}: missing document language`);
        requireCondition(
            elements(doc, "h1").some((node) => node.textContent.trim()),
            `${route}: missing main heading`,
        );
        requireCondition(
            !elements(head, "meta").some((node) => node.getAttribute("http-equiv")?.toLowerCase() === "refresh"),
            `${route}: content page redirects with meta refresh`,
        );
        requireCondition(isNoIndex(doc) === globalNoIndex, `${route}: noindex differs from the deployment policy`);
        jsonLd(doc, route);
        const alternates = alternateMap(links, route);
        requireCondition(!route.endsWith("/") || alternates.size > 0, `${route}: localized page has no hreflang`);
        pages.set(route, { doc, canonical, alternates });
    }
    requireCondition(pages.size > 0, "deployment has no content pages");

    const knownOrigins = new Set([origin, ...[...pages.values()].map((page) => page.canonical.origin)]);
    for (const [route, page] of pages) {
        const { canonical, alternates, doc } = page;
        if (canonical.origin === origin && !globalNoIndex) {
            requireCondition(entries.has(canonical.href), `${route}: canonical page missing from sitemap`);
        }
        if (alternates.size > 0) {
            requireCondition(alternates.has("x-default"), `${route}: missing x-default alternate`);
            requireCondition(
                [...alternates.values()].includes(canonical.href),
                `${route}: hreflang omits its own canonical`,
            );
            for (const [lang, href] of alternates) {
                const target = pages.get(new URL(href).pathname);
                requireCondition(
                    target?.canonical.href === href,
                    `${route}: hreflang ${lang} targets a missing or non-canonical page ${href}`,
                );
                requireCondition(
                    sameAlternates(alternates, target.alternates),
                    `${route}: hreflang graph differs from ${href}`,
                );
                if (lang !== "x-default") {
                    requireCondition(
                        target.doc.documentElement.getAttribute("lang").toLowerCase().split("-")[0] ===
                            lang.split("-")[0],
                        `${route}: hreflang ${lang} does not match target language`,
                    );
                }
            }
        }

        function checkReference(value, label) {
            if (!value || value.startsWith("#")) return;
            const url = new URL(value, canonical);
            if (!knownOrigins.has(url.origin)) return;
            requireCondition(localFile(url.pathname), `${route}: ${label} references missing local resource ${value}`);
        }

        for (const node of elements(doc, "a")) checkReference(node.getAttribute("href"), "link");
        for (const node of elements(doc, "link")) checkReference(node.getAttribute("href"), "head link");
        for (const tag of ["img", "script", "source", "video"]) {
            for (const node of elements(doc, tag)) {
                checkReference(node.getAttribute("src"), tag);
                checkReference(node.getAttribute("poster"), "video poster");
                const srcset = node.getAttribute("srcset");
                if (srcset && !srcset.startsWith("data:")) {
                    for (const candidate of srcset.split(","))
                        checkReference(candidate.trim().split(/\s+/)[0], "srcset");
                }
            }
        }
        for (const name of ["og:image", "twitter:image"]) {
            for (const value of metaValues(doc, name)) checkReference(value, name);
        }
    }

    for (const { url, alternates } of entries.values()) {
        const page = pages.get(url.pathname);
        requireCondition(page?.canonical.href === url.href, `sitemap URL has no matching canonical HTML: ${url.href}`);
        requireCondition(sameAlternates(alternates, page.alternates), `${url.href}: sitemap and HTML hreflang differ`);
    }
    const redirects = readFileSync(join(DIST, "_redirects"), "utf8");
    for (const line of redirects.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const [source, , status = "302"] = line.trim().split(/\s+/);
        requireCondition(
            ["200", "301", "302", "303", "307", "308"].includes(status),
            `unsupported Cloudflare redirect status: ${line}`,
        );
        const pattern = new RegExp(
            `^${source
                .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
                .replace(/:[A-Za-z]\w*/g, "[^/]+")
                .replace(/\*/g, ".*")}$`,
        );
        for (const { url } of entries.values()) {
            requireCondition(!pattern.test(url.pathname), `sitemap URL matches a redirect or rewrite: ${url.href}`);
        }
    }
    process.stdout.write(
        `[check-seo] OK - ${pages.size} HTML pages, ${entries.size} sitemap URLs, ${globalNoIndex ? "noindex" : "indexable"} deployment\n`,
    );
}

try {
    check();
} catch (error) {
    process.stderr.write(`[check-seo] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { minify } from "rolldown/utils";
import { transformWithOxc } from "vite";
import type { I18nKey } from "../src/i18n/keys.js";
import { escapeAttr, escapeText } from "./html-utils.js";

interface CompressionOptions {
    locale: string;
    fullVersionUrl: string;
    faviconDataUrl: string;
    csp: string;
    dictionary: Record<I18nKey, string>;
}

export async function compressPortableHtml(html: string, options: CompressionOptions): Promise<string> {
    const file = resolve("src/portable/bootstrap.ts");
    const transformed = await transformWithOxc(readFileSync(file, "utf8"), file, { target: "es2022" });
    const bootstrap = (await minify(file.replace(/\.ts$/, ".js"), transformed.code)).code.replace(
        /<\/script/gi,
        "<\\/script",
    );
    const hash = createHash("sha256").update(bootstrap).digest("base64");
    const csp = options.csp.replace("script-src blob:", `script-src blob: 'sha256-${hash}'`);
    const payload = gzipSync(html, { level: 9 }).toString("base64");
    const dict = options.dictionary;
    // Replacing documentElement can skip Chromium's favicon discovery; keep the
    // same icon in the initial shell and the restored application.
    const favicon = `<link rel="icon" href="${escapeAttr(options.faviconDataUrl)}">`;
    const shellStyle = `:root{color-scheme:light dark;--bg:#f5f4f1;--bg-elev:#fff;--fg:#0e0e0e;--fg-dim:#6f6a5c;--border:#dcd8cd;--accent:#ff9000}@media(prefers-color-scheme:dark){:root{--bg:#000;--bg-elev:#1a1a1a;--fg:#fff;--fg-dim:#8a8a8a;--border:#2a2a2a}}*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}#dc-portable-startup{width:100%;max-width:30rem;padding:32px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);text-align:center}#dc-portable-startup h1{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 20px;font-size:24px;line-height:1;letter-spacing:-.04em}#dc-portable-startup h1 svg{width:28px;height:28px;flex:none}#dc-portable-startup p{margin:0;color:var(--fg-dim)}#dc-portable-startup a{display:inline-block;margin-top:24px;padding:8px 16px;border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:14px;font-weight:600;text-decoration:none}#dc-portable-startup a:hover{border-color:var(--accent)}#dc-portable-startup a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(max-width:400px){body{padding:16px}#dc-portable-startup{padding:28px 20px}}`;
    return `<!doctype html><html lang="${escapeAttr(options.locale)}" class="is-loading" data-edition="portable" data-portable-state="loading"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>dashcamigo</title>${favicon}<style>${shellStyle}</style></head><body><main id="dc-portable-startup"><h1>dashcamigo<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="3" y="7" width="26" height="20" rx="3" fill="currentColor"/><rect x="14" y="4" width="4" height="3" rx=".6" fill="currentColor"/><circle cx="16" cy="17" r="7" fill="#ff9000"/><circle cx="16" cy="17" r="4" fill="#000"/></svg></h1><p id="dc-portable-status" role="status" data-unsupported="${escapeAttr(dict["portable.startupUnsupported"])}" data-failed="${escapeAttr(dict["portable.startupFailed"])}">${escapeText(dict["portable.loading"])}</p><noscript><style>#dc-portable-status{display:none}</style><p>${escapeText(dict["portable.javascriptRequired"])}</p></noscript><a id="dc-portable-full-version" href="${escapeAttr(options.fullVersionUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(dict["portable.fullVersion"])}</a></main><script id="dc-portable-payload" type="application/gzip">${payload}</script><script type="module">${bootstrap}</script></body></html>`;
}

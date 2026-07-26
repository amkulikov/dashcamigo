// CSP modal: opens from the landing safety wall (#csp-open) and from the FAQ
// Q3 inline link (#csp-open-2). The DOM, plus the source-of-truth CSP string,
// lives in index.html. Here we:
//   1. Read #csp-source JSON (CSP header bytes, identical to public/_headers),
//   2. Split by ';' into directives, classify each value as self / none /
//      external, attach a per-directive annotation pulled from i18n
//      (landing.csp.annot.<directive>), render into #csp-full.
//   3. Wire open/close: two open buttons, the close button, Esc, backdrop
//      click. Body scroll is locked while the modal is open.
//
import { escapeHtml } from "../escape.js";
import { type I18nKey, t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

const log = createLogger("csp-modal");

const ANNOTATED_DIRECTIVES = new Set([
    "default-src",
    "script-src",
    "style-src",
    "font-src",
    "img-src",
    "connect-src",
    "worker-src",
    "media-src",
    "manifest-src",
    "object-src",
    "frame-src",
    "child-src",
    "base-uri",
    "form-action",
    "frame-ancestors",
    "upgrade-insecure-requests",
]);

/**
 * Classify a single CSP source value to pick its CSS color class.
 *   - 'self' / 'none' / other quoted keywords - dedicated colors;
 *   - http(s)://... and *. wildcards - external (orange);
 *   - bare keywords like blob:, data: - treated as "self-like" (green) since
 *     they restrict to local-origin schemes, not external hosts.
 */
function classifySource(src: string): "self" | "none" | "ext" {
    if (src === "'none'") return "none";
    if (src === "'self'") return "self";
    if (src.startsWith("'")) return "self";
    if (src.startsWith("http") || src.startsWith("*") || src.includes(".")) return "ext";
    return "self";
}

/** Render #csp-full from #csp-source. Idempotent. Called on init and lang change. */
function renderCsp(): void {
    const sourceEl = document.getElementById("csp-source");
    const target = document.getElementById("csp-full");
    if (!sourceEl || !target) return;

    let raw: string;
    try {
        raw = JSON.parse(sourceEl.textContent ?? '""');
    } catch (err) {
        log.warn("csp-source parse failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    if (typeof raw !== "string" || raw.length === 0) return;

    const lines: string[] = [];
    for (const part of raw.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const tokens = trimmed.split(/\s+/);
        const name = tokens[0];
        if (!name) continue;
        const values = tokens.slice(1);
        let line = `<span class="landing-csp-full-dir">${escapeHtml(name)}</span>`;
        if (values.length) {
            line +=
                " " +
                values
                    .map((v) => `<span class="landing-csp-full-${classifySource(v)}">${escapeHtml(v)}</span>`)
                    .join(" ");
        }
        if (ANNOTATED_DIRECTIVES.has(name)) {
            const annotKey = `landing.csp.annot.${name}` as I18nKey;
            line += `<span class="landing-csp-full-annot">// ${escapeHtml(t(annotKey))}</span>`;
        }
        lines.push(`${line};`);
    }
    target.innerHTML = lines.join("\n");
}

let modalEl: HTMLElement | null = null;

/** Open the CSP modal. Scroll-lock, focus-trap and focus restore are handled
 *  by the shared modal manager (activateModal). */
export function openCspModal(): void {
    if (!modalEl) return;
    modalEl.hidden = false;
    modalEl.classList.add("is-open");
    // Close button is the only always-rendered interactive control in the header.
    const closeBtn = document.getElementById("csp-close");
    activateModal(modalEl, { onClose: closeCspModal, initialFocus: closeBtn });
}

/** Close the CSP modal. */
export function closeCspModal(): void {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    modalEl.hidden = true;
    deactivateModal(modalEl);
}

/** Wire all open/close listeners + initial render. Safe to call once on startup. */
export function initCspModal(): void {
    modalEl = document.getElementById("csp-modal");
    if (!modalEl) return;

    renderCsp();

    document.getElementById("csp-open")?.addEventListener("click", openCspModal);
    document.getElementById("csp-open-2")?.addEventListener("click", openCspModal);
    document.getElementById("csp-close")?.addEventListener("click", closeCspModal);

    // Only the backdrop closes; a click inside the .landing-csp-modal card hits
    // the card, not modalEl.
    wireBackdropDismiss(modalEl, closeCspModal);

    // Escape is handled centrally by the modal manager (activateModal).
}

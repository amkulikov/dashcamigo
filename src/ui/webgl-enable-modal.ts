// "Turn the map on" modal. Shown when the map's WebGL is missing but indirect
// signals say it is recoverable (hardware acceleration off / GPU blocklist) -
// see classifyWebglRecovery() in src/capabilities.ts. The DOM shell lives in
// index.html (#webgl-enable-modal, static data-i18n copy); this controller only
// wires open/close and the in-panel re-entry link. A11y (scroll-lock, focus
// trap, Escape, focus restore) comes from the shared modal manager.
//
// The copy NAMES WebGL explicitly - a deliberate exception to the "no jargon"
// voice rule (.claude/rules/voice.md): WebGL is the user's searchable term,
// matching the browser's own settings, chrome://gpu and get.webgl.org. It is
// paired with the plain fix the user actually flips - hardware acceleration.

import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

const log = createLogger("webgl-enable-modal");

let modalEl: HTMLElement | null = null;

// Whether we PROVED the GPU is alive (software renderer / WebGPU) vs only guessed
// the cause. Drives which intro line the modal shows. Set by the capability gate
// before it opens or reveals the guide; defaults to the hedged intro.
let confidentCause = false;

// Coarse cause of the WebGL gap (softwareRendering / gpuAlive / modernDesktop),
// carried only into the webgl_enable_shown analytics event - so we can see in the
// wild which signal fired, in particular whether the load-bearing modernDesktop
// guess over-fires. Set by the capability gate before open/reveal alongside the
// confidence flag; "" until then.
let surfaceReason = "";

/** Records whether the missing-map cause is proven (true) or a guess (false), so
 *  the modal leads with a direct vs hedged intro. Call before open/reveal. */
export function setMapEnableConfidence(confident: boolean): void {
    confidentCause = confident;
}

/** Records the coarse verdict reason for the analytics event (not shown to the
 *  user). Call before open/reveal, next to setMapEnableConfidence. */
export function setMapEnableReason(reason: string): void {
    surfaceReason = reason;
}

/**
 * Opens the modal. Auto-open (from the capability gate, source "auto") and
 * manual-open (from the in-panel link, source "manual") share this; the in-panel
 * link works even after an auto-show, so there is no dismiss gate here - the
 * gate's once-per-gap-set ack governs the auto path. Idempotent via the shared
 * modal manager.
 */
export function openWebglEnableModal(source: "auto" | "manual"): void {
    if (!modalEl) return;
    // Pick the intro by confidence (re-resolved via t() so it follows the current
    // language too, not just the static prerendered fallback).
    const intro = document.getElementById("webgl-enable-intro");
    if (intro) intro.textContent = t(confidentCause ? "webglEnable.introConfident" : "webglEnable.intro");
    modalEl.hidden = false;
    modalEl.classList.add("is-open");
    const closeBtn = document.getElementById("webgl-enable-close");
    activateModal(modalEl, { onClose: closeWebglEnableModal, initialFocus: closeBtn });
    log.info("map enable guide shown", { source, reason: surfaceReason });
}

function closeWebglEnableModal(): void {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    modalEl.hidden = true;
    deactivateModal(modalEl);
}

/** Reveals the in-panel "how to turn the map on" link (hidden by default). Called
 *  by the capability gate only when the WebGL gap looked recoverable, so a
 *  genuinely incapable GPU never gets a walkthrough that cannot help. */
export function revealMapEnableLink(): void {
    document.getElementById("map-unavailable-how")?.removeAttribute("hidden");
}

/** Wires open/close listeners. Safe to call once on startup; no-op without the
 *  shell. Must run before the capability gate may auto-open the modal. */
export function initWebglEnableModal(): void {
    modalEl = document.getElementById("webgl-enable-modal");
    if (!modalEl) return;

    document.getElementById("webgl-enable-close")?.addEventListener("click", closeWebglEnableModal);
    // Backdrop click closes; clicks inside the card do not reach modalEl.
    wireBackdropDismiss(modalEl, closeWebglEnableModal);
    // In-panel re-entry: always opens, even after the auto-show was acked.
    document.getElementById("map-unavailable-how")?.addEventListener("click", () => openWebglEnableModal("manual"));

    // Escape is handled centrally by the modal manager (activateModal).
}

// Keeps the same live player in native fullscreen or an expanded viewport.
// Browser-owned transitions are immediate; only the surrounding controls move.

import { t } from "../i18n/index.js";
import type { I18nKey } from "../i18n/keys.js";
import { createLogger } from "../log.js";
import { dom, onActivePlayerEvent } from "./dom.js";
import { setExportModePreparation, subscribeExportState } from "./export-state.js";
import { applyMapLayout } from "./map.js";
import { isCoarsePointer, prefersReducedMotion } from "./media-queries.js";
import { focusableWithin, isAnyModalOpen } from "./modal-helper.js";
import { notify } from "./notifications.js";
import { state } from "./state.js";
import { setExpandedViewPanels } from "./view-menu.js";

const log = createLogger("player");
const HIDE_DELAY_MS = 3000;
const CONTROL_SELECTOR = ".player-bar, .player-chart, .player-readout, .player-fullscreen-actions";
const OPEN_MENU_SELECTOR =
    ".player-speed-menu:not([hidden]), .view-menu-popover:not([hidden]), .overflow-menu:not([hidden]), .player-volume-popover:not([hidden])";
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let motionTimer: ReturnType<typeof setTimeout> | null = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
let transition: Promise<boolean> | null = null;
let isViewportExpanded = false;
let hasShownHint = false;
let isPinned = false;
let shouldRestoreFocus = true;
let savedFocus: HTMLElement | null = null;
let savedScroll: { element: Element; left: number; top: number }[] = [];
const backgroundInert = new Map<HTMLElement, boolean>();
const hoveredControls = new Set<Element>();
const activePointers = new Set<number>();

function isExpanded(): boolean {
    return dom.playerWrap.classList.contains("player-expanded");
}

function canUseNativeFullscreen(): boolean {
    return typeof dom.playerWrap.requestFullscreen === "function" && document.fullscreenEnabled === true;
}

function clearHideTimer(): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
}

function revealControls(): void {
    if (!isExpanded()) return;
    dom.playerWrap.classList.add("controls-visible");
    clearHideTimer();
    scheduleHideControls();
}

function scheduleHideControls(): void {
    if (hideTimer !== null) return;
    if (!isExpanded() || isPinned || dom.player.paused || dom.player.ended) return;
    hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!isExpanded()) return;
        const focused = document.activeElement;
        const hasKeyboardFocus =
            focused instanceof HTMLElement && focused.matches(":focus-visible") && dom.playerWrap.contains(focused);
        if (
            isPinned ||
            dom.player.paused ||
            dom.player.ended ||
            hoveredControls.size ||
            activePointers.size ||
            hasKeyboardFocus ||
            isAnyModalOpen() ||
            dom.playerWrap.querySelector(OPEN_MENU_SELECTOR)
        ) {
            scheduleHideControls();
            return;
        }
        dom.playerWrap.classList.remove("controls-visible");
    }, HIDE_DELAY_MS);
}

function showHint(key: I18nKey, delay = HIDE_DELAY_MS): void {
    const hint = document.getElementById("player-fullscreen-hint");
    if (!hint) return;
    if (hintTimer !== null) clearTimeout(hintTimer);
    hint.textContent = t(key);
    hint.hidden = false;
    hintTimer = setTimeout(() => {
        hint.hidden = true;
        hintTimer = null;
    }, delay);
}

function saveViewerContext(): void {
    savedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    savedScroll = [];
    for (let element: Element | null = dom.playerWrap.parentElement; element; element = element.parentElement) {
        savedScroll.push({ element, left: element.scrollLeft, top: element.scrollTop });
    }
    shouldRestoreFocus = true;
}

function isolateViewportPlayer(): void {
    // Fixed banners also belong to the background. Dialog overlays must stay
    // interactive when the modal manager adopts them into the player.
    for (let child: Element = dom.playerWrap; child.parentElement; child = child.parentElement) {
        for (const sibling of child.parentElement.children) {
            if (
                sibling === child ||
                !(sibling instanceof HTMLElement) ||
                sibling.matches(".modal-overlay") ||
                sibling.getClientRects().length === 0
            ) {
                continue;
            }
            backgroundInert.set(sibling, sibling.inert);
            sibling.inert = true;
        }
    }
}

function syncExpandedState(expanded: boolean): void {
    if (expanded === isExpanded()) return;
    if (motionTimer !== null) clearTimeout(motionTimer);
    clearHideTimer();
    hoveredControls.clear();
    activePointers.clear();
    dom.playerWrap.classList.remove("fullscreen-entering", "fullscreen-leaving");
    dom.playerWrap.classList.toggle("player-expanded", expanded);
    dom.playerWrap.classList.toggle("player-viewport", expanded && isViewportExpanded);
    document.body.classList.toggle("has-expanded-player", expanded);
    dom.playerWrap.classList.toggle("controls-visible", expanded);
    const pin = document.getElementById("player-controls-pin");
    if (pin) pin.hidden = !expanded;
    setExpandedViewPanels(expanded);
    if (expanded) {
        if (isViewportExpanded) isolateViewportPlayer();
        if (!hasShownHint && !isCoarsePointer()) {
            showHint("player.fullscreen.hint");
            hasShownHint = true;
        }
        if (!dom.playerWrap.contains(document.activeElement)) dom.playerBar.fullscreen.focus({ preventScroll: true });
        scheduleHideControls();
    } else {
        if (hintTimer !== null) clearTimeout(hintTimer);
        hintTimer = null;
        const hint = document.getElementById("player-fullscreen-hint");
        if (hint) hint.hidden = true;
        for (const [element, inert] of backgroundInert) element.inert = inert;
        backgroundInert.clear();
        for (const { element, left, top } of savedScroll) {
            element.scrollLeft = left;
            element.scrollTop = top;
        }
        savedScroll = [];
        if (shouldRestoreFocus && !isAnyModalOpen()) {
            const target =
                savedFocus?.isConnected && savedFocus.offsetParent !== null ? savedFocus : dom.playerBar.fullscreen;
            target.focus({ preventScroll: true });
        }
        savedFocus = null;
    }
    if (!prefersReducedMotion()) {
        const motionClass = expanded ? "fullscreen-entering" : "fullscreen-leaving";
        dom.playerWrap.classList.add(motionClass);
        motionTimer = setTimeout(
            () => {
                dom.playerWrap.classList.remove(motionClass);
                motionTimer = null;
            },
            expanded ? 220 : 160,
        );
    }
    syncFullscreenButton();
    applyMapLayout();
    document.dispatchEvent(new Event("playerexpansionchange"));
}

function runTransition(action: () => Promise<boolean>): Promise<boolean> {
    const pending = action().finally(() => {
        transition = null;
        syncFullscreenButton();
    });
    transition = pending;
    syncFullscreenButton();
    return pending;
}

function exitExpandedPlayer(restoreFocus = true): Promise<boolean> {
    if (transition) return transition.then(() => exitExpandedPlayer(restoreFocus));
    if (!isExpanded()) return Promise.resolve(true);
    shouldRestoreFocus = restoreFocus;
    return runTransition(async () => {
        try {
            if (document.fullscreenElement === dom.playerWrap) await document.exitFullscreen();
            isViewportExpanded = false;
            syncExpandedState(false);
            return true;
        } catch (error) {
            log.warn("fullscreen exit failed", { error: error instanceof Error ? error.message : String(error) });
            revealControls();
            showHint("player.fullscreen.exitError", 6000);
            return false;
        }
    });
}

export async function toggleFullscreen(): Promise<void> {
    if (transition) return;
    if (isExpanded()) {
        await exitExpandedPlayer();
        return;
    }
    if (!state.active || state.exportModeOpen || isAnyModalOpen()) return;
    saveViewerContext();
    await runTransition(async () => {
        try {
            if (canUseNativeFullscreen()) {
                // The request must retain the triggering user activation.
                await dom.playerWrap.requestFullscreen();
                syncExpandedState(document.fullscreenElement === dom.playerWrap);
            } else {
                // iPhone may lack container fullscreen. Keep every camera and
                // custom control in the available viewport without hiding Safari.
                isViewportExpanded = true;
                syncExpandedState(true);
            }
            return isExpanded();
        } catch (error) {
            savedFocus = null;
            savedScroll = [];
            log.warn("fullscreen entry failed", { error: error instanceof Error ? error.message : String(error) });
            notify({ severity: "warn", messageKey: "player.fullscreen.error" });
            return false;
        }
    });
}

export function syncFullscreenButton(): void {
    const expanded = isExpanded();
    const native = canUseNativeFullscreen();
    const label = expanded
        ? t(isViewportExpanded ? "player.fullscreen.restore" : "player.fullscreen.exit")
        : t(native ? "player.fullscreen.enter" : "player.fullscreen.expand");
    const button = dom.playerBar.fullscreen;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.disabled = !expanded && (!state.active || state.exportModeOpen);
    button.setAttribute("aria-busy", String(transition !== null));
    button.querySelector(".fullscreen-enter-icon")?.toggleAttribute("hidden", expanded);
    button.querySelector(".fullscreen-exit-icon")?.toggleAttribute("hidden", !expanded);
    const text = button.querySelector(".fullscreen-label");
    if (text) text.textContent = expanded ? t("player.fullscreen.exitShort") : label;
    const key = button.querySelector<HTMLElement>(".fullscreen-key");
    if (key) {
        key.textContent = expanded ? "Esc" : "F";
        key.hidden = isCoarsePointer();
    }
    const pin = document.getElementById("player-controls-pin");
    if (pin) {
        pin.setAttribute("aria-label", t("player.controls.pin"));
        pin.setAttribute("aria-pressed", String(isPinned));
        pin.title = t("player.controls.pin");
    }
}

export function initPlayerFullscreen(): void {
    dom.playerBar.fullscreen.addEventListener("click", toggleFullscreen);
    document.getElementById("player-controls-pin")?.addEventListener("click", () => {
        isPinned = !isPinned;
        syncFullscreenButton();
        revealControls();
    });
    setExportModePreparation(() => (isExpanded() || transition ? exitExpandedPlayer(false) : null));
    subscribeExportState(syncFullscreenButton);
    document.addEventListener("fullscreenchange", () => {
        if (!isViewportExpanded) syncExpandedState(document.fullscreenElement === dom.playerWrap);
    });
    document.addEventListener("keydown", (event) => {
        if (!isExpanded() || isAnyModalOpen() || event.defaultPrevented) return;
        if (!event.ctrlKey && !event.metaKey && !event.altKey) revealControls();
        if (event.key === "Escape" && isViewportExpanded) {
            // Overflow installs its dismiss listener when opened, after this
            // one. Let that first Escape close the menu before leaving view.
            if (dom.playerWrap.querySelector(".overflow-menu:not([hidden])")) return;
            event.preventDefault();
            void exitExpandedPlayer();
        }
        if (event.key !== "Tab") return;
        revealControls();
        if (!isViewportExpanded) return;
        const controls = focusableWithin(dom.playerWrap);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dom.playerWrap.contains(document.activeElement))) {
            event.preventDefault();
            last?.focus();
        } else if (
            !event.shiftKey &&
            (document.activeElement === last || !dom.playerWrap.contains(document.activeElement))
        ) {
            event.preventDefault();
            first?.focus();
        }
    });
    dom.playerWrap.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") revealControls();
    });
    dom.playerWrap.addEventListener("focusin", (event) => {
        if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR)) revealControls();
    });
    dom.playerWrap.addEventListener("focusout", scheduleHideControls);
    let shouldRevealTouch = false;
    dom.playerWrap.addEventListener(
        "pointerdown",
        (event) => {
            shouldRevealTouch =
                event.pointerType !== "mouse" && isExpanded() && !dom.playerWrap.classList.contains("controls-visible");
        },
        true,
    );
    dom.playerWrap.addEventListener(
        "click",
        (event) => {
            if (!shouldRevealTouch || event.detail === 0 || !isExpanded() || isAnyModalOpen()) return;
            shouldRevealTouch = false;
            event.stopPropagation();
            event.preventDefault();
            revealControls();
        },
        true,
    );
    for (const control of dom.playerWrap.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
        control.addEventListener("pointerenter", (event) => {
            if (event.pointerType !== "mouse") return;
            hoveredControls.add(control);
            revealControls();
        });
        control.addEventListener("pointerleave", () => {
            hoveredControls.delete(control);
            scheduleHideControls();
        });
        control.addEventListener("pointerdown", (event) => {
            if (!isExpanded()) return;
            activePointers.add(event.pointerId);
            revealControls();
        });
    }
    const releasePointer = (event: PointerEvent): void => {
        if (activePointers.delete(event.pointerId)) scheduleHideControls();
    };
    document.addEventListener("pointerup", releasePointer);
    document.addEventListener("pointercancel", releasePointer);
    // Automatic clip and preload-slot changes are not user activity. Keep the
    // idle deadline across them, and reveal only once playback really stops.
    onActivePlayerEvent("play", scheduleHideControls);
    for (const event of ["pause", "ended"] as const) {
        onActivePlayerEvent(event, () => {
            requestAnimationFrame(() => {
                if (dom.player.paused || dom.player.ended) revealControls();
            });
        });
    }
    syncFullscreenButton();
}

// Fullscreen toggle + auto-hide controls in fullscreen mode.
// Owns: the fullscreen button (click + aria), the document fullscreenchange
// listener that drives the .controls-visible class, the mousemove/mouseenter/
// mouseleave timers that hide the toolbar after 2s.
//
// Why request fullscreen on player-wrap (not <video>): keeps our custom
// toolbar visible. Otherwise the browser shows only the video with native
// controls, which we intentionally hide.

import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { dom } from "./dom.js";

const log = createLogger("player");

const FULLSCREEN_HIDE_DELAY_MS = 2000;
let fullscreenHideTimer: ReturnType<typeof setTimeout> | null = null;

export async function toggleFullscreen(): Promise<void> {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            await dom.playerWrap.requestFullscreen();
        }
    } catch (e) {
        // requestFullscreen can reject if the user gesture has expired - not
        // critical, just log for diagnostics.
        log.warn("fullscreen toggle failed", e);
    }
}

function scheduleHideFullscreenControls(): void {
    if (fullscreenHideTimer) clearTimeout(fullscreenHideTimer);
    fullscreenHideTimer = setTimeout(() => {
        fullscreenHideTimer = null;
        if (!document.fullscreenElement) return;
        dom.playerWrap.classList.remove("controls-visible");
    }, FULLSCREEN_HIDE_DELAY_MS);
}

export function syncFullscreenButton(): void {
    const inFs = document.fullscreenElement === dom.playerWrap;
    const label = inFs ? t("player.fullscreen.exit") : t("player.fullscreen.enter");
    dom.playerBar.fullscreen.setAttribute("aria-label", label);
    dom.playerBar.fullscreen.title = label;
    // Same icon in both states - readable both ways; meaning conveyed via aria-label/title.
}

export function initPlayerFullscreen(): void {
    dom.playerBar.fullscreen.addEventListener("click", toggleFullscreen);

    document.addEventListener("fullscreenchange", () => {
        syncFullscreenButton();
        // On fullscreen enter, show controls immediately (user just clicked -
        // needs feedback). On exit, unconditionally remove the class so stale
        // state does not linger on re-entry.
        dom.playerWrap.classList.toggle("controls-visible", !!document.fullscreenElement);
        if (fullscreenHideTimer) {
            clearTimeout(fullscreenHideTimer);
            fullscreenHideTimer = null;
        }
        if (document.fullscreenElement) {
            scheduleHideFullscreenControls();
        }
    });

    dom.playerWrap.addEventListener("mousemove", () => {
        if (!document.fullscreenElement) return;
        dom.playerWrap.classList.add("controls-visible");
        scheduleHideFullscreenControls();
    });

    // Touch has no mousemove, so on a phone the 2s timer would strand the user
    // in fullscreen with the controls hidden and no way back. Mirror the YouTube/
    // Netflix model: a tap on the video surface reveals the controls.
    //
    // click (not pointerup) is used so we can swallow it in the capture phase
    // BEFORE the at-target play/pause listener on the <video> fires - a reveal
    // tap must not also toggle playback. pointerType is read from a preceding
    // pointerdown because click events don't carry it.
    let lastPointerWasTouch = false;
    dom.playerWrap.addEventListener(
        "pointerdown",
        (e) => {
            lastPointerWasTouch = e.pointerType !== "mouse";
        },
        true,
    );
    dom.playerWrap.addEventListener(
        "click",
        (e) => {
            if (!document.fullscreenElement) return;
            if (!lastPointerWasTouch) return;
            // Controls already visible: let the tap fall through to play/pause.
            if (dom.playerWrap.classList.contains("controls-visible")) return;
            // Controls hidden: this tap ONLY reveals them; stop it reaching the
            // tile's play/pause handler.
            e.stopPropagation();
            dom.playerWrap.classList.add("controls-visible");
            scheduleHideFullscreenControls();
        },
        true,
    );

    // Don't hide controls while the mouse is over the player-bar / chart -
    // otherwise buttons run away from the cursor. mousemove on playerWrap also
    // fires here, but we additionally cancel the timer on bar mouseenter so
    // controls don't disappear between events.
    for (const el of [dom.playerBar.play.parentElement, document.getElementById("player-chart")]) {
        if (!el) continue;
        el.addEventListener("mouseenter", () => {
            if (!document.fullscreenElement) return;
            if (fullscreenHideTimer) {
                clearTimeout(fullscreenHideTimer);
                fullscreenHideTimer = null;
            }
            dom.playerWrap.classList.add("controls-visible");
        });
        el.addEventListener("mouseleave", () => {
            if (!document.fullscreenElement) return;
            scheduleHideFullscreenControls();
        });
        // Touch equivalent: keep controls up while a finger is interacting with
        // the bar/chart (e.g. dragging the scrubber for >2s), re-arm the hide on
        // release. Without this the controls vanish mid-drag on a phone.
        el.addEventListener("pointerdown", (e) => {
            if (!document.fullscreenElement || e.pointerType === "mouse") return;
            if (fullscreenHideTimer) {
                clearTimeout(fullscreenHideTimer);
                fullscreenHideTimer = null;
            }
            dom.playerWrap.classList.add("controls-visible");
        });
        el.addEventListener("pointerup", (e) => {
            if (!document.fullscreenElement || e.pointerType === "mouse") return;
            scheduleHideFullscreenControls();
        });
    }
}

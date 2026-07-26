// Overflow-bar for the player-bar. On a wide desktop the kebab is hidden - all
// controls fit in one row. On a narrow one (mobile or an open map) the secondary
// controls move into the kebab so play, the current time/speed readout and the
// Export button stay visible.
//
// Mobile contract (see player-bar.css MOBILE PLAYER BAR comment): play +
// current-time + speed metric + playback-speed + view-menu + Export + kebab stay
// inline; help/capture/loop/view-mode/mute/fullscreen/map collapse into the kebab
// highest-priority-first. Export is priority 1 (last to leave), and the narrow-bar
// gap shrink in player-bar.css keeps the mandatory floor under the viewport, so
// Export is never the control forced out - the bug where it disappeared into the
// kebab on narrow portrait. map/fullscreen are simple one-shot clicks, so the
// default kebab row (el.click()) drives them - no popover-anchored control is
// collapsed, so none needs a custom inline renderer.
//
// Item visibility in the bar already depends on state (view-mode hidden if only
// 1 channel; map shown only on mobile via CSS). overflow-bar respects this via
// isAvailable - an unavailable item enters neither overflow nor the kebab menu.

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { type OverflowableItem, initOverflowBar } from "./overflow-bar.js";
import { state } from "./state.js";
import { applyVolumeLevel } from "./player-volume.js";

export function initPlayerBarOverflow() {
    const bar = document.getElementById("player-bar");
    const button = document.getElementById("player-overflow") as HTMLButtonElement | null;
    const menu = document.getElementById("player-overflow-menu") as HTMLUListElement | null;
    if (!bar || !button || !menu) return;

    const muteWrap = document.querySelector<HTMLElement>(".player-mute-wrap");
    const mute = document.getElementById("player-mute") as HTMLButtonElement | null;
    const capture = document.getElementById("player-capture") as HTMLButtonElement | null;
    const loop = document.getElementById("player-loop") as HTMLButtonElement | null;
    const viewMode = document.getElementById("player-view-mode") as HTMLButtonElement | null;
    const help = document.getElementById("player-help") as HTMLButtonElement | null;
    const map = document.getElementById("player-map") as HTMLButtonElement | null;
    const fullscreen = document.getElementById("player-fullscreen") as HTMLButtonElement | null;
    const exportBtn = document.getElementById("player-export") as HTMLButtonElement | null;
    const items: OverflowableItem[] = [];

    // Priorities: HIGH priority = drop FIRST (see overflow-bar.ts header). The
    // least-useful-on-mobile controls (help, capture, loop, view-mode) leave the
    // bar first; mute/fullscreen next; the map toggle stays longest (it is the
    // ONLY entry to the map on mobile, the mini-map circle being hidden there).
    // Export (priority 1) is always the last to go - so on every real phone width
    // it stays inline instead of disappearing into the kebab.
    if (help) {
        items.push({
            el: help,
            priority: 10,
            label: () => t("player.help.title"),
            isAvailable: () => !help.hidden,
        });
    }
    if (capture) {
        items.push({
            el: capture,
            priority: 9,
            label: () => t("player.capture"),
            isAvailable: () => !capture.hidden,
        });
    }
    if (loop) {
        items.push({
            el: loop,
            priority: 8,
            label: () => (loop.getAttribute("aria-pressed") === "true" ? t("player.loop.on") : t("player.loop.off")),
            isAvailable: () => !loop.hidden,
            isActive: () => loop.getAttribute("aria-pressed") === "true",
        });
    }
    if (viewMode) {
        items.push({
            el: viewMode,
            priority: 7,
            label: () => t("player.view.toggle"),
            isAvailable: () => !viewMode.hidden,
        });
    }
    // Mute (together with the volume popover wrap): collapse the whole wrap so the
    // volume range does not stay DOM-positioned against a hidden mute button. The
    // wrap holds the real slider, which goes display:none on collapse, so the
    // kebab renders its own slider (custom row) - drag to 0 mutes.
    if (mute && muteWrap) {
        items.push({
            el: muteWrap,
            priority: 6,
            // Unused for rendering (customMenuRow owns the row); kept because the
            // contract requires a label and it is the accessible name fallback.
            label: () => (dom.player.muted ? t("player.unmute") : t("player.mute")),
            isAvailable: () => !muteWrap.hidden,
            customMenuRow: renderVolumeMenuRow,
        });
    }
    if (fullscreen) {
        items.push({
            el: fullscreen,
            priority: 5,
            label: () => t("player.fullscreen.enter"),
            isAvailable: () => !fullscreen.hidden,
        });
    }
    // Map toggle: mobile-only (the mini-map circle is hidden there). It is
    // display:none on desktop via CSS - offsetParent is null then - so isAvailable
    // gates it on actual visibility, not the `hidden` attribute (it never carries
    // one). Kept longest of the collapsibles so it stays inline on common phone
    // widths; on the narrowest bars the kebab clone preserves access.
    if (map) {
        items.push({
            el: map,
            priority: 4,
            label: () => t("miniMap.expandAria"),
            isAvailable: () => map.offsetParent !== null,
        });
    }
    // Export is the LAST control to leave the bar (lowest priority): the secondary
    // actions above overflow first and Export stays reachable inline. Default
    // onActivate = exportBtn.click() -> openOrCloseExportMode (wired in
    // export-panel.ts), so the kebab clone opens export-mode just like the in-bar
    // button on the rare width where nothing else can be dropped.
    if (exportBtn) {
        items.push({
            el: exportBtn,
            priority: 1,
            label: () => t("player.export.label"),
            isAvailable: () => !exportBtn.hidden,
        });
    }

    const handle = initOverflowBar({
        container: bar,
        overflowButton: button,
        overflowMenu: menu,
        items,
    });

    return handle;
}

/**
 * Renders the volume row shown when the mute cluster collapses into the kebab.
 * A single horizontal range (the bar's own popover slider is vertical and lives
 * inside the display:none'd wrap), initialised from the live state each time the
 * menu opens; dragging to 0 mutes (applyVolumeLevel owns that rule). The menu
 * stays open while dragging - the level is continuous, unlike the one-shot rows.
 */
function renderVolumeMenuRow(): HTMLElement {
    const li = document.createElement("li");
    li.className = "overflow-menu-item overflow-menu-item--volume";
    li.setAttribute("role", "none");

    const label = document.createElement("span");
    label.className = "overflow-menu-section-label";
    label.textContent = t("player.volume");

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "overflow-menu-volume-slider";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.05";
    slider.value = String(state.preferredMuted ? 0 : state.preferredVolume);
    slider.setAttribute("aria-label", t("player.volume"));
    slider.addEventListener("input", (e) => {
        e.stopPropagation();
        applyVolumeLevel(Number(slider.value));
    });

    li.appendChild(label);
    li.appendChild(slider);
    return li;
}

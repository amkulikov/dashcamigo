import { flipCropRect, hasCameraFlip } from "../camera-flip.js";
import { t } from "../i18n/index.js";
import { ALL_CHANNELS, channelTileFor } from "./dom.js";
import { cameraFlipForChannel, saveCameraFlip } from "./camera-flip-pref.js";
import { notifyExportStateChanged, subscribeExportState } from "./export-state.js";
import { channelDisplayLabel } from "./format.js";
import { initMenuKeyboard } from "./menu-keyboard.js";
import { exitCropEditIfOpen } from "./player-crop.js";
import { activeTrip, state } from "./state.js";

export function syncCameraFlips(): void {
    const trip = activeTrip();
    for (const ch of ALL_CHANNELS) {
        const tile = channelTileFor(ch);
        const flip = cameraFlipForChannel(ch);
        tile.style.setProperty(
            "--camera-flip",
            `translate(${flip.horizontal ? 100 : 0}%, ${flip.vertical ? 100 : 0}%) scale(${flip.horizontal ? -1 : 1}, ${flip.vertical ? -1 : 1})`,
        );
        tile.style.setProperty("--camera-flip-x", flip.horizontal ? "-1" : "1");
        tile.style.setProperty("--camera-flip-y", flip.vertical ? "-1" : "1");
        tile.classList.toggle("camera-flipped", hasCameraFlip(flip));
        const button = tile.querySelector<HTMLButtonElement>(".camera-settings-button");
        if (button) {
            button.disabled = state.transcodeInProgress;
            button.title = t("player.camera.settings", {
                camera: trip ? channelDisplayLabel(ch, trip) : "",
            });
            button.setAttribute("aria-label", button.title);
        }
        const menu = tile.querySelector<HTMLElement>(".camera-settings-menu");
        if (
            menu?.matches(":popover-open") &&
            (state.transcodeInProgress || menu.getAttribute("aria-label") !== button?.title)
        ) {
            menu.hidePopover();
        }
        for (const axis of ["horizontal", "vertical"] as const) {
            tile.querySelector(`[data-flip="${axis}"]`)?.setAttribute("aria-checked", String(flip[axis]));
        }
    }
}

export function initPlayerCameraFlip(): void {
    for (const ch of ALL_CHANNELS) {
        const tile = channelTileFor(ch);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "camera-settings-button";
        button.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>`;
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        const menu = document.createElement("div");
        menu.id = `camera-settings-${ch}`;
        menu.className = "camera-settings-menu";
        menu.popover = "auto";
        menu.setAttribute("role", "menu");
        button.setAttribute("aria-controls", menu.id);
        button.setAttribute("popovertarget", menu.id);
        for (const axis of ["horizontal", "vertical"] as const) {
            const item = document.createElement("button");
            item.type = "button";
            item.tabIndex = -1;
            item.dataset.flip = axis;
            item.setAttribute("role", "menuitemcheckbox");
            item.title = t(`player.camera.flip.${axis}`);
            item.setAttribute("aria-label", item.title);
            item.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><g${axis === "vertical" ? ' transform="rotate(90 10 10)"' : ""}><path d="M10 2v16" stroke-dasharray="2 2"/><path d="M3 5v10l4-2V7z"/><path d="M17 5v10l-4-2V7z" fill="currentColor" fill-opacity=".25"/></g></svg>`;
            item.addEventListener("click", () => {
                if (state.transcodeInProgress) return;
                exitCropEditIfOpen();
                const flip = cameraFlipForChannel(ch);
                const slot = state.composition.channelOrder.indexOf(ch);
                const crop = state.composition.perSlotCrops[slot];
                if (crop)
                    state.composition.perSlotCrops[slot] = flipCropRect(crop, {
                        horizontal: axis === "horizontal",
                        vertical: axis === "vertical",
                    });
                saveCameraFlip(ch, { ...flip, [axis]: !flip[axis] });
                syncCameraFlips();
                notifyExportStateChanged();
            });
            menu.append(item);
        }
        menu.setAttribute("aria-description", t("player.camera.flip.hint"));
        tile.append(button, menu);
        const close = (): void => menu.hidePopover();
        const open = (): void => {
            const trip = activeTrip();
            if (!trip || state.transcodeInProgress) return;
            syncCameraFlips();
            menu.setAttribute("aria-label", button.title);
            menu.showPopover();
            const anchor = button.getBoundingClientRect();
            const rect = menu.getBoundingClientRect();
            menu.style.left = `${Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8))}px`;
            menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 8))}px`;
            menu.querySelector<HTMLButtonElement>("button")?.focus();
        };
        button.addEventListener("click", (event) => {
            event.preventDefault();
            if (menu.matches(":popover-open")) close();
            else open();
        });
        menu.addEventListener("toggle", () =>
            button.setAttribute("aria-expanded", String(menu.matches(":popover-open"))),
        );
        for (const el of [button, menu]) {
            for (const event of ["click", "dblclick", "pointerdown"])
                el.addEventListener(event, (e) => e.stopPropagation());
        }
        initMenuKeyboard({ button, menu, itemSelector: "button", onOpen: open, onClose: close });
        const observer = new MutationObserver(() => {
            if (tile.hidden || state.transcodeInProgress) close();
        });
        observer.observe(tile, { attributes: true, attributeFilter: ["hidden"] });
    }
    subscribeExportState(syncCameraFlips);
    syncCameraFlips();
}

// Offline banner controller. Shows the thin top strip (#offline-banner in
// index.html) whenever connectivity.ts reports effective offline, and wires the
// info button -> detail popover.
//
// No i18n logic here: the banner copy is tagged data-i18n / data-i18n-attr, so
// applyStaticI18n() (run on every language switch) re-localizes it for free.

import { subscribeConnectivity } from "./connectivity.js";

/**
 * Initialize the offline banner. Subscribes to connectivity (which calls back
 * immediately with the current state) and binds the info popover. Safe to call
 * when the banner element is absent (returns early).
 */
export function initOfflineBanner(): void {
    const banner = document.getElementById("offline-banner");
    if (!banner) return;
    const infoBtn = document.getElementById("offline-banner-info");
    const popover = document.getElementById("offline-banner-popover");

    function closePopover(): void {
        if (!popover || popover.hidden) return;
        popover.hidden = true;
        infoBtn?.setAttribute("aria-expanded", "false");
        infoBtn?.classList.remove("is-open");
    }

    subscribeConnectivity((offline) => {
        banner.hidden = !offline;
        // The body class is a CSS state hook. The banner overlays existing
        // chrome, so toggling connectivity never changes page geometry.
        document.body.classList.toggle("has-offline-banner", offline);
        // Going back online closes a left-open popover so it can't linger over
        // a now-hidden banner.
        if (!offline) closePopover();
    });

    if (infoBtn && popover) {
        infoBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            // hidden is boolean | "until-found"; only an explicit false is visible.
            const willOpen = popover.hidden !== false;
            popover.hidden = !willOpen;
            infoBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
            infoBtn.classList.toggle("is-open", willOpen);
        });
        // Outside-click + Escape dismiss (mirrors the view-menu popover pattern).
        document.addEventListener("click", (e) => {
            if (popover.hidden) return;
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.closest("#offline-banner-popover") || target.closest("#offline-banner-info")) return;
            closePopover();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !popover.hidden) {
                e.preventDefault();
                closePopover();
                infoBtn.focus();
            }
        });
    }
}

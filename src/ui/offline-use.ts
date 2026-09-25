import { getDateLocale, t } from "../i18n/index.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { getPwaInstallState, requestPwaInstall, subscribePwaInstallState } from "./pwa-install.js";

export function initOfflineUse(): void {
    const entry = document.getElementById("offline-use-btn");
    const modal = document.getElementById("offline-use-modal");
    const closeButton = document.getElementById("offline-use-close");
    const installButton = document.getElementById("install-btn");
    const status = document.getElementById("offline-use-app-status");
    const fileSection = document.getElementById("offline-use-file");
    const download = document.getElementById("portable-download");
    const size = document.getElementById("offline-use-size");
    if (!entry || !modal || !closeButton || !installButton || !status || !fileSection) return;

    fileSection.hidden = !(download instanceof HTMLAnchorElement && download.hasAttribute("href"));
    modal.classList.toggle("offline-use-modal--single", fileSection.hidden);
    const bytes = Number(download?.dataset.portableBytes);
    if (size && Number.isFinite(bytes) && bytes > 0) {
        size.textContent = new Intl.NumberFormat(getDateLocale(), {
            style: "unit",
            unit: "megabyte",
            unitDisplay: "short",
            maximumFractionDigits: 1,
        }).format(bytes / 1_000_000);
    }

    const sync = (): void => {
        const state = getPwaInstallState();
        modal.dataset.installState = state;
        installButton.hidden = state === "unsupported" || state === "installed";
        installButton.textContent = t(state === "guide" ? "offlineUse.app.guide" : "pwa.install.cta");
        status.hidden = state !== "installed" && state !== "unsupported";
        status.textContent = status.hidden
            ? ""
            : t(state === "installed" ? "offlineUse.app.installed" : "offlineUse.app.unavailable");
    };
    const close = (): void => {
        modal.hidden = true;
        deactivateModal(modal);
    };
    entry.addEventListener("click", () => {
        sync();
        // Overflow rows are rebuilt after activation; save their stable trigger.
        (entry.offsetParent ? entry : document.getElementById("topbar-overflow"))?.focus({ preventScroll: true });
        modal.hidden = false;
        activateModal(modal, { onClose: close, initialFocus: closeButton });
    });
    closeButton.addEventListener("click", close);
    wireBackdropDismiss(modal, close, { cardSelector: ".offline-use-card" });
    installButton.addEventListener("click", () => {
        close();
        void requestPwaInstall();
    });
    subscribePwaInstallState(sync);
}

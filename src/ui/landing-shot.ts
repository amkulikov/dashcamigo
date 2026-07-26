// Landing hero-shot lightbox: the composite thumb in the hero's right column
// holds two buttons - the desktop shot (#landing-shot-open) and the phone shot
// overlapping its corner (#landing-shot-open-phone) - and each opens the
// lightbox with ITS full-size variant. A click ANYWHERE inside the open
// lightbox - the image included - or Escape closes it. A picture peek, not a
// workflow modal, so there is no card that should swallow clicks and no close
// button. Scroll-lock, Escape and focus restore come from the shared modal
// manager. DOM lives in index.html (#landing-shot-lightbox).

import { t } from "../i18n/index.js";
import { activateModal, deactivateModal } from "./modal-helper.js";

type ShotVariant = "desktop" | "phone";

let lightboxEl: HTMLElement | null = null;
let desktopImg: HTMLImageElement | null = null;
let phoneImg: HTMLImageElement | null = null;

function openShotLightbox(variant: ShotVariant): void {
    if (!lightboxEl || !desktopImg || !phoneImg) return;
    desktopImg.hidden = variant !== "desktop";
    phoneImg.hidden = variant !== "phone";
    // The dialog is labelled by the variant on show: the static data-i18n-attr
    // label only covers the pre-open default (desktop).
    lightboxEl.setAttribute(
        "aria-label",
        t(variant === "desktop" ? "landing.hero.shot.alt" : "landing.hero.shot.altPhone"),
    );
    lightboxEl.hidden = false;
    lightboxEl.classList.add("is-open");
    // Nothing focusable inside - focus lands on the root (tabindex=-1),
    // which the manager's trap then pins Tab to.
    activateModal(lightboxEl, { onClose: closeShotLightbox });
}

function closeShotLightbox(): void {
    if (!lightboxEl) return;
    lightboxEl.classList.remove("is-open");
    lightboxEl.hidden = true;
    deactivateModal(lightboxEl);
}

/** Wires the hero-shot thumbs to the lightbox. Safe to call once on startup;
 *  no-op when the landing markup is absent. */
export function initLandingShot(): void {
    lightboxEl = document.getElementById("landing-shot-lightbox");
    if (!lightboxEl) return;
    desktopImg = lightboxEl.querySelector<HTMLImageElement>(".landing-shot-lightbox-desktop");
    phoneImg = lightboxEl.querySelector<HTMLImageElement>(".landing-shot-lightbox-phone");
    document.getElementById("landing-shot-open")?.addEventListener("click", () => openShotLightbox("desktop"));
    document.getElementById("landing-shot-open-phone")?.addEventListener("click", () => openShotLightbox("phone"));
    lightboxEl.addEventListener("click", closeShotLightbox);
}

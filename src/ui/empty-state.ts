// What to show over the player before a trip is selected or when the codec is unsupported.
// Both are "negative" viewer states, kept together.

import { t } from "../i18n/index.js";
import type { VideoCodec } from "mediabunny";

import { dom } from "./dom.js";
import { state } from "./state.js";

/**
 * Toggles empty-state vs player-wrap visibility and fills the placeholder text.
 * Empty-state is shown while nothing is selected (state.active === null):
 *  - Before any ingest: product screenshot (UX-03).
 *  - Trips loaded but none selected: "pick one on the left" hint.
 */
export function syncEmptyState(): void {
    if (!dom.viewer) return;
    const isEmpty = !state.active;
    dom.viewer.classList.toggle("empty", isEmpty);
    if (!isEmpty) return;
    const card = document.getElementById("empty-state-card");
    if (!card) return;
    if (state.trips.length === 0) {
        // Theoretically dead code: trips=0 shows the landing page (body.no-trips).
        // Safe fallback in case landing is ever removed.
        card.innerHTML = `
            <div class="empty-state-title">${t("emptyState.first.title")}</div>
            <ol class="empty-state-steps">
                <li>${t("emptyState.first.step1")}</li>
                <li>${t("emptyState.first.step2")}</li>
                <li>${t("emptyState.first.step3")}</li>
            </ol>
            <div class="empty-state-hint">${t("emptyState.first.hint")}</div>
        `;
    } else {
        // .feedback-link opens the feedback form (delegated in feedback.ts) -
        // the escape hatch for "a trip loaded, but recognition looks wrong"
        // (front/rear swapped, mode missing), which the zero-trips path misses.
        card.innerHTML = `
            <div class="empty-state-title">${t("emptyState.withTrips.title")}</div>
            <div class="empty-state-hint">${t("emptyState.withTrips.hint", { n: state.trips.length })}</div>
            <button type="button" class="empty-state-report feedback-link" data-feedback-preset="other">${t("emptyState.withTrips.report")}</button>
        `;
    }
}

/**
 * Shows the "browser cannot play this codec" overlay.
 * Used when the selected VideoCandidate.canPlay === false (mediabunny canDecodeVideo returned false on ingest).
 * Called in playFrame before setting <video>.src so the user sees the reason instead of a black frame.
 */
export function showCodecUnsupportedOverlay(codec: VideoCodec | null): void {
    if (!dom.viewer) return;
    dom.viewer.classList.add("codec-unsupported");
    // Localize the whole title via t(); {codec} placeholder is substituted with the codec name.
    const titleEl = document.getElementById("codec-unsupported-title");
    if (titleEl) {
        const codecName = codec ? codec.toUpperCase() : t("codecUnsupported.unknown");
        titleEl.textContent = t("codecUnsupported.title", { codec: codecName });
    }
}

export function hideCodecUnsupportedOverlay(): void {
    if (!dom.viewer) return;
    dom.viewer.classList.remove("codec-unsupported");
}

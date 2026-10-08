// The author's note waits for returning use and a quiet moment. Automatic
// reminders respect the cooldown; the note stays available in About.

import { getCurrentLang, t } from "../i18n/index.js";
import { REPO_URL } from "../i18n/seo-config.js";
import { createLogger } from "../log.js";

import { dom, onActivePlayerEvent } from "./dom.js";
import { isAnyModalOpen } from "./modal-helper.js";
import { isOnboardingSettledForSupportPrompt } from "./onboarding.js";
import { state } from "./state.js";
import { observePromptSurfaces } from "./prompt-surfaces.js";

const log = createLogger("support-prompt");

const STORAGE_FIRST_USE_AT = "dashcamigo:support:first-use-at";
const STORAGE_LAST_SHOWN_AT = "dashcamigo:support:last-shown-at";
const STORAGE_ACTION_TAKEN = "dashcamigo:support:action-taken";
const RETURN_DELAY_MS = 24 * 60 * 60 * 1000;
const PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const COPY_FEEDBACK_MS = 1400;

let promptRetryArmed = false;
let promptRetryTimer: number | null = null;
let blockerObserver: MutationObserver | null = null;
let hasReturningUse = false;
let returnFocus: HTMLElement | null = null;

function getBanner(): HTMLElement | null {
    return document.getElementById("support-banner");
}

function wasSupportActionTaken(): boolean {
    try {
        return localStorage.getItem(STORAGE_ACTION_TAKEN) === "1";
    } catch {
        return true;
    }
}

function isPromptOnCooldown(): boolean {
    try {
        const stored = localStorage.getItem(STORAGE_LAST_SHOWN_AT);
        if (stored === null) return false;
        const lastShownAt = Number.parseInt(stored, 10);
        if (!Number.isFinite(lastShownAt) || lastShownAt <= 0) return false;
        return Date.now() - lastShownAt < PROMPT_COOLDOWN_MS;
    } catch {
        return true;
    }
}

function rememberPromptShown(): boolean {
    try {
        localStorage.setItem(STORAGE_LAST_SHOWN_AT, String(Date.now()));
        return true;
    } catch {
        return false;
    }
}

function markSupportActionTaken(): void {
    try {
        localStorage.setItem(STORAGE_ACTION_TAKEN, "1");
    } catch {
        // The current prompt still closes; without persistence its existing
        // 30-day cooldown remains the best available fallback.
    }
}

/** Only opening recordings can qualify a return; leaving a tab open cannot. */
export function recordSuccessfulLoadForSupportPrompt(): boolean {
    hasReturningUse = false;
    if (wasSupportActionTaken() || isPromptOnCooldown()) return false;
    try {
        const now = Date.now();
        // An earlier prompt is also evidence of past use.
        const firstUseAt = Number(
            localStorage.getItem(STORAGE_FIRST_USE_AT) ?? localStorage.getItem(STORAGE_LAST_SHOWN_AT) ?? "0",
        );
        if (!Number.isFinite(firstUseAt) || firstUseAt <= 0 || firstUseAt > now) {
            localStorage.setItem(STORAGE_FIRST_USE_AT, String(now));
            return false;
        }
        hasReturningUse = now - firstUseAt >= RETURN_DELAY_MS;
        return hasReturningUse;
    } catch {
        return false;
    }
}

function hasCompetingBanner(): boolean {
    const sticky = Array.from(document.querySelectorAll<HTMLElement>(".sticky-banner:not([hidden])"));
    if (sticky.some((banner) => banner.id !== "support-banner")) return true;
    return document.getElementById("lang-banner") !== null;
}

/** Stops the session-local retry loop after exposure or permanent ineligibility. */
function disarmPromptRetry(): void {
    promptRetryArmed = false;
    if (promptRetryTimer !== null) {
        window.clearTimeout(promptRetryTimer);
        promptRetryTimer = null;
    }
    blockerObserver?.disconnect();
    blockerObserver = null;
}

/** Coalesces release signals and retries after the closing handler has settled. */
function schedulePromptRetry(): void {
    if (!promptRetryArmed || promptRetryTimer !== null) return;
    promptRetryTimer = window.setTimeout(() => {
        promptRetryTimer = null;
        if (promptRetryArmed) maybeShowSupportPrompt();
    }, 0);
}

/**
 * Watches only UI layers that can temporarily own the prompt's slot. Direct
 * body children cover the dynamically-created onboarding overlay; static
 * dialogs/panels and the two banners are observed at their own roots so normal
 * player/chart DOM churn cannot wake the retry loop.
 */
function observePromptBlockers(): void {
    if (blockerObserver || typeof MutationObserver === "undefined") return;
    blockerObserver = observePromptSurfaces(schedulePromptRetry);
    blockerObserver.observe(dom.viewer, { attributes: true, attributeFilter: ["class"] });
}

function armPromptRetry(): void {
    promptRetryArmed = true;
    observePromptBlockers();
}

/** Attempts now and keeps an eligible prompt armed across temporary blockers. */
export function maybeShowSupportPrompt(): boolean {
    if (wasSupportActionTaken() || isPromptOnCooldown()) {
        disarmPromptRetry();
        return false;
    }
    if (!hasReturningUse) {
        disarmPromptRetry();
        return false;
    }

    const banner = getBanner();
    if (!banner) {
        disarmPromptRetry();
        return false;
    }

    const temporarilyBlocked =
        document.visibilityState !== "visible" ||
        (document.fullscreenElement ?? document.querySelector(".player-expanded")) !== null ||
        state.exportModeOpen ||
        state.transcodeInProgress ||
        !dom.player.paused ||
        dom.player.seeking ||
        dom.viewer.matches(".preparing, .codec-unsupported, .playback-failed") ||
        isAnyModalOpen() ||
        hasCompetingBanner() ||
        !isOnboardingSettledForSupportPrompt();
    if (temporarilyBlocked) {
        armPromptRetry();
        return false;
    }

    // Start the cooldown on actual exposure, even if the tab closes before the
    // user chooses an action. If that cannot be persisted, do not risk nagging.
    if (!rememberPromptShown()) {
        disarmPromptRetry();
        return false;
    }
    disarmPromptRetry();
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    banner.hidden = false;
    return true;
}

function hideBanner(): void {
    const banner = getBanner();
    if (!banner) return;
    const shouldRestoreFocus = banner.contains(document.activeElement);
    banner.hidden = true;
    if (shouldRestoreFocus) returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
}

function projectUrl(): string {
    // The prerendered canonical already accounts for primary/mirror ownership.
    // Fallback keeps a self-hosted/dev copy useful if that tag is absent.
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    return canonical ?? new URL(`/${getCurrentLang()}/`, location.origin).href;
}

function fallbackCopy(text: string): boolean {
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    } finally {
        field.remove();
    }
    return copied;
}

async function copyProjectLink(button: HTMLButtonElement): Promise<void> {
    let copied = false;
    try {
        await navigator.clipboard.writeText(projectUrl());
        copied = true;
    } catch (err) {
        log.debug("clipboard API unavailable, trying selection fallback", {
            err: err instanceof Error ? err.message : String(err),
        });
        copied = fallbackCopy(projectUrl());
        button.focus({ preventScroll: true });
    }
    if (copied) markSupportActionTaken();
    const key = copied ? "supportPrompt.copied" : "supportPrompt.copyFailed";
    button.dataset.i18n = key;
    button.textContent = t(key);
    window.setTimeout(() => {
        if (copied) hideBanner();
        button.dataset.i18n = "supportPrompt.copy";
        button.textContent = t("supportPrompt.copy");
    }, COPY_FEEDBACK_MS);
}

/** Wires the static banner markup. Called once from app.ts. */
export function initSupportPrompt(): void {
    // MutationObserver covers DOM-backed layers; these events cover the two
    // browser-owned blockers, plus an interaction fallback for a future UI
    // surface that does not expose its close through [hidden]/DOM removal.
    document.addEventListener("visibilitychange", schedulePromptRetry);
    document.addEventListener("fullscreenchange", schedulePromptRetry);
    document.addEventListener("playerexpansionchange", schedulePromptRetry);
    document.addEventListener("click", schedulePromptRetry);
    document.addEventListener("keydown", schedulePromptRetry, true);
    onActivePlayerEvent("pause", schedulePromptRetry);
    onActivePlayerEvent("seeked", schedulePromptRetry);
    onActivePlayerEvent("ended", schedulePromptRetry);

    for (const github of document.querySelectorAll<HTMLAnchorElement>(".support-github")) {
        github.href = REPO_URL;
        github.addEventListener("click", () => {
            markSupportActionTaken();
            hideBanner();
        });
    }
    document.getElementById("support-banner-close")?.addEventListener("click", hideBanner);
    getBanner()?.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        hideBanner();
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>(".support-copy")) {
        button.addEventListener("click", () => void copyProjectLink(button));
    }
}

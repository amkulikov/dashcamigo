// Post-use project-support prompt. It counts only recording loads that added at
// least one playable recording, appears no earlier than the second, and yields
// to onboarding, modals, fullscreen and higher-priority banners. An earned
// prompt stays armed while one of those temporary surfaces owns the UI, then
// retries as soon as the surface leaves; it never requires another recording
// load just because its first opportunity was busy. Dismissing it starts a
// 30-day cooldown; completing one of its support actions retires it.

import { getCurrentLang, t } from "../i18n/index.js";
import { REPO_URL } from "../i18n/seo-config.js";
import { createLogger } from "../log.js";

import { isAnyModalOpen } from "./modal-helper.js";
import { isOnboardingSettledForSupportPrompt } from "./onboarding.js";
import { state } from "./state.js";

const log = createLogger("support-prompt");

const STORAGE_SUCCESSFUL_LOADS = "dashcamigo:support:successful-loads";
const STORAGE_LAST_SHOWN_AT = "dashcamigo:support:last-shown-at";
const STORAGE_ACTION_TAKEN = "dashcamigo:support:action-taken";
const LOADS_BEFORE_PROMPT = 2;
const PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const COPY_FEEDBACK_MS = 1400;

let promptRetryArmed = false;
let promptRetryTimer: number | null = null;
let blockerObserver: MutationObserver | null = null;

function getBanner(): HTMLElement | null {
    return document.getElementById("support-banner");
}

function getCopyButton(): HTMLButtonElement | null {
    return document.getElementById("support-banner-copy") as HTMLButtonElement | null;
}

function readSuccessfulLoads(): number | null {
    try {
        const stored = Number.parseInt(localStorage.getItem(STORAGE_SUCCESSFUL_LOADS) ?? "0", 10);
        if (!Number.isFinite(stored) || stored < 0) return 0;
        return Math.min(stored, LOADS_BEFORE_PROMPT);
    } catch {
        // Without persistence we cannot enforce the cooldown, so the
        // respectful fallback is not to show the prompt.
        return null;
    }
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

/** Records one meaningful load and returns whether the two-load threshold is met. */
export function recordSuccessfulLoadForSupportPrompt(): boolean {
    if (wasSupportActionTaken() || isPromptOnCooldown()) return false;
    const previous = readSuccessfulLoads();
    if (previous === null) return false;
    const next = Math.min(previous + 1, LOADS_BEFORE_PROMPT);
    try {
        localStorage.setItem(STORAGE_SUCCESSFUL_LOADS, String(next));
    } catch {
        return false;
    }
    return next >= LOADS_BEFORE_PROMPT;
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
    blockerObserver = new MutationObserver(schedulePromptRetry);

    if (document.body) blockerObserver.observe(document.body, { childList: true });
    for (const surface of document.querySelectorAll<HTMLElement>('.sticky-banner, [role="dialog"], #export-panel')) {
        blockerObserver.observe(surface, { attributes: true, attributeFilter: ["hidden"] });
    }

    // The language suggestion is mounted inside .lang-wrap rather than body.
    const langBannerParent = document.getElementById("lang-banner")?.parentElement;
    if (langBannerParent && langBannerParent !== document.body) {
        blockerObserver.observe(langBannerParent, { childList: true });
    }
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
    const successfulLoads = readSuccessfulLoads();
    if (successfulLoads === null || successfulLoads < LOADS_BEFORE_PROMPT) {
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
    banner.hidden = false;
    return true;
}

function hideBanner(): void {
    const banner = getBanner();
    if (banner) banner.hidden = true;
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

async function copyProjectLink(): Promise<void> {
    const button = getCopyButton();
    if (!button) return;

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
    button.textContent = t(copied ? "supportPrompt.copied" : "supportPrompt.copyFailed");
    window.setTimeout(() => {
        if (copied) {
            hideBanner();
            return;
        }
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

    const github = document.getElementById("support-banner-github") as HTMLAnchorElement | null;
    if (github) {
        github.href = REPO_URL;
        github.addEventListener("click", () => {
            markSupportActionTaken();
            hideBanner();
        });
    }
    document.getElementById("support-banner-later")?.addEventListener("click", hideBanner);
    getCopyButton()?.addEventListener("click", () => {
        void copyProjectLink();
    });
}

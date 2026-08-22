// Post-use project-support prompt. It counts only recording loads that added at
// least one playable recording, appears no earlier than the second, and yields
// to onboarding, modals, fullscreen and higher-priority banners. Dismissing it
// starts a 30-day cooldown; completing one of its support actions retires it.
// No prompt queue: if the current moment is busy, a later successful load gets
// another chance instead of stacking asks back-to-back.

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

/** Attempts the prompt now; a false result is intentionally not queued. */
export function maybeShowSupportPrompt(): boolean {
    if (wasSupportActionTaken() || isPromptOnCooldown()) return false;
    const successfulLoads = readSuccessfulLoads();
    if (successfulLoads === null || successfulLoads < LOADS_BEFORE_PROMPT) return false;
    if (document.visibilityState !== "visible" || document.fullscreenElement) return false;
    if (state.exportModeOpen || isAnyModalOpen() || hasCompetingBanner()) return false;
    if (!isOnboardingSettledForSupportPrompt(state.trips)) return false;

    const banner = getBanner();
    if (!banner) return false;
    // Start the cooldown on actual exposure, even if the tab closes before the
    // user chooses an action. If that cannot be persisted, do not risk nagging.
    if (!rememberPromptShown()) return false;
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

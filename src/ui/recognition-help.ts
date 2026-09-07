import { t } from "../i18n/index.js";
import { recordsHaveGps } from "../parser.js";
import { failedGpsFilesForTrip, hasUnfinishedRecognition } from "../recognition-gps.js";
import { findUnpairedCameraIssue } from "../recognition-issues.js";
import { tripAllCandidates, type VideoCandidate } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";

import { isAnyModalOpen } from "./modal-helper.js";
import { isOnboardingSettledForSupportPrompt } from "./onboarding.js";
import { observePromptSurfaces } from "./prompt-surfaces.js";
import { activeTrip, state } from "./state.js";

interface RecognitionInvitation {
    reason: "gps" | "cameras";
    fileKeys: string[];
    scopes: string[];
}

const offeredScopes = new Set<string>();
let currentScopes: string[] = [];
let pendingRefresh: number | null = null;
let isInitialized = false;

function setVisible(element: HTMLElement | null, visible: boolean): void {
    if (element && element.hidden === visible) element.hidden = !visible;
}

function setText(element: HTMLElement | null, value: string): void {
    if (element && element.textContent !== value) element.textContent = value;
}

function scopesFor(reason: RecognitionInvitation["reason"], files: readonly VideoCandidate[]): string[] {
    return [...new Set(files.map((file) => JSON.stringify([reason, file.sourceKey ?? file.fingerprint])))];
}

function invitationsForActiveTrip(): RecognitionInvitation[] {
    const trip = activeTrip();
    if (!trip || state.recordingAnalysisProgress !== null) return [];
    const candidates = tripAllCandidates(trip);
    const all = state.trips.flatMap(tripAllCandidates);
    const identities = new Set(
        candidates.map((candidate) => JSON.stringify([candidate.sourceKey, candidate.fingerprint])),
    );
    const related = all.filter((candidate) =>
        identities.has(JSON.stringify([candidate.sourceKey, candidate.fingerprint])),
    );
    // A sibling's pending GPS can still regroup provisional trips and supply a route.
    if (hasUnfinishedRecognition(related, state)) return [];
    const invitations: RecognitionInvitation[] = [];
    const gpsFiles = failedGpsFilesForTrip(trip, state);
    if (gpsFiles.length > 0) {
        const keys = new Set(gpsFiles);
        invitations.push({
            reason: "gps",
            fileKeys: gpsFiles,
            scopes: scopesFor(
                "gps",
                candidates.filter((candidate) => keys.has(vendorFileKey(candidate))),
            ),
        });
    }

    const cameras = findUnpairedCameraIssue(trip, state.trips);
    if (cameras) {
        const keys = new Set(cameras.fileKeys);
        const affected = all.filter((candidate) => keys.has(vendorFileKey(candidate)));
        invitations.push({ reason: "cameras", fileKeys: cameras.fileKeys, scopes: scopesFor("cameras", affected) });
    }
    return invitations;
}

function isBlocked(): boolean {
    return (
        document.visibilityState !== "visible" ||
        document.fullscreenElement !== null ||
        document.querySelector(
            ".player-expanded, .viewer.preparing, .viewer.codec-unsupported, .viewer.playback-failed",
        ) !== null ||
        state.exportModeOpen ||
        state.transcodeInProgress ||
        isAnyModalOpen() ||
        !isOnboardingSettledForSupportPrompt() ||
        document.querySelector(
            ".sticky-banner:not(#recognition-banner):not(#support-banner):not([hidden]), #lang-banner",
        ) !== null
    );
}

function syncRecognitionHelp(): void {
    const banner = document.getElementById("recognition-banner");
    const trip = activeTrip();
    const isSettled = !!trip && !hasUnfinishedRecognition(tripAllCandidates(trip), state);
    setVisible(document.getElementById("recognition-gps-menu"), isSettled && !recordsHaveGps(trip?.records ?? []));
    if (!trip || !isSettled || isBlocked()) {
        setVisible(banner, false);
        return;
    }
    const invitations = invitationsForActiveTrip().filter((invitation) =>
        invitation.scopes.some((scope) => !offeredScopes.has(scope) || currentScopes.includes(scope)),
    );
    if (invitations.length === 0) {
        currentScopes = [];
        setVisible(banner, false);
        return;
    }
    const first = invitations[0]!;
    setText(document.getElementById("recognition-title"), t(`recognition.${first.reason}.title`));
    for (const reason of ["gps", "cameras"] as const) {
        const body = document.getElementById(`recognition-${reason}-body`);
        setText(body, t(`recognition.${reason}.body`));
        setVisible(
            body,
            invitations.some((invitation) => invitation.reason === reason),
        );
    }
    const contact = document.getElementById("recognition-contact");
    if (contact) {
        contact.dataset.feedbackPreset = first.reason;
        const candidates = state.trips.flatMap(tripAllCandidates);
        contact.dataset.recognitionIssue = invitations
            .map((invitation) => {
                const keys = new Set(invitation.fileKeys);
                const paths = candidates
                    .filter((candidate) => keys.has(vendorFileKey(candidate)))
                    .map((candidate) => candidate.relativePath || candidate.file.name);
                return `${invitation.reason === "gps" ? "gps extraction failed" : "recognized cameras remain unpaired"}:\n${paths.join("\n")}`;
            })
            .join("\n\n");
    }
    currentScopes = invitations.flatMap((invitation) => invitation.scopes);
    for (const scope of currentScopes) offeredScopes.add(scope);
    // A recording problem takes priority over asking for project support.
    setVisible(document.getElementById("support-banner"), false);
    setVisible(banner, true);
}

/** Coalesces settled trip updates and UI blocker changes. Never runs per video frame. */
export function scheduleRecognitionHelp(): void {
    if (!isInitialized || pendingRefresh !== null) return;
    pendingRefresh = window.setTimeout(() => {
        pendingRefresh = null;
        syncRecognitionHelp();
    }, 0);
}

export function initRecognitionHelp(): void {
    if (isInitialized) return;
    isInitialized = true;
    const dismiss = () => {
        const banner = document.getElementById("recognition-banner");
        const shouldRestoreFocus = banner?.contains(document.activeElement);
        currentScopes = [];
        setVisible(banner, false);
        if (shouldRestoreFocus) document.getElementById("player-play")?.focus({ preventScroll: true });
    };
    document.getElementById("recognition-later")?.addEventListener("click", dismiss);
    document.getElementById("recognition-contact")?.addEventListener("click", dismiss);
    const observer = observePromptSurfaces(scheduleRecognitionHelp);
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    const viewer = document.querySelector(".viewer");
    if (viewer) observer.observe(viewer, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", scheduleRecognitionHelp);
    document.addEventListener("fullscreenchange", scheduleRecognitionHelp);
    document.addEventListener("playerexpansionchange", scheduleRecognitionHelp);
    document.addEventListener("click", scheduleRecognitionHelp);
}

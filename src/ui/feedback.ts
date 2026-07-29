// "Report a problem" feedback flow. A small guided wizard, no free-text field
// and no in-app attachments (the user writes in their own email; real recordings
// are shared via a link). Three steps inside one modal:
//
//   1. recordings - real files help most; the user shares a download link
//      (Google Drive/Dropbox/... - open list) or skips.
//   2. report     - download a single .txt technical report (env + state +
//      folder structure + recent log). One human-readable file, no zip, no JSON.
//   3. hand-off   - the file is in Downloads; email it to feedback@ and attach
//      it (plus the recordings link, if any).
//
// mailto cannot attach, so the address appears only in the hand-off, next to the
// downloaded file - never as a fileless action. No Web Share (canShare is true
// on desktop macOS too, where the OS sheet offers AirDrop/Messages - useless for
// reaching feedback@). No backend anywhere.

import { collectDiagnostics, serializeDiagnosticsText, utcTimestampSlug } from "../diagnostics.js";
import { downloadBlob } from "../download.js";
import { getDateLocale, t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { buildStructureReport } from "../report-structure.js";
import { captureSentryException } from "../sentry.js";
import { displayClockDate, wallToContentSec } from "../trips.js";
import { formatDistanceFromKm } from "../units-pref.js";
import { APP_VERSION } from "../version.js";
import { dom } from "./dom.js";
import { formatTime } from "./format.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { notify } from "./notifications.js";
import { activeCandidate, activeFrame, isFocusLayout, mainChannel, state } from "./state.js";

const log = createLogger("feedback");

const FEEDBACK_EMAIL = "feedback@dashcamigo.app";

/** First lines of the report .txt: what it is and where to send it. English by
 *  design - the whole report body is technical/English (voice.md exception). */
const REPORT_HEADER = [
    "dashcamigo — technical details for diagnosis",
    `Please email this file to ${FEEDBACK_EMAIL} — attach it to your message. It has no video and no location, just technical details that help us reproduce the problem or add your camera.`,
].join("\n");

/** Selected error-entry-point topic; only tags the mail subject. */
let preset: string | null = null;

/** Name of the report .txt downloaded this session, if any - drives the mail
 *  body's "attach this file" reminder. Reset on every modal open. */
let downloadedReportName: string | null = null;

/** Whether the user said they have a recordings link (step 1) - adds a paste
 *  placeholder to the email body. Reset on every modal open. */
let hasRecordingsLink = false;

function modalEl(): HTMLElement | null {
    return document.getElementById("feedback-modal");
}

function getEl<T extends HTMLElement>(sel: string): T | null {
    const m = modalEl();
    if (!m) return null;
    return m.querySelector<T>(sel);
}

/** Valid preset keys - whitelist matches i18n/keys.ts (feedback.step1.preset.*). Unknown presets are ignored so t() does not throw MissingValueError on a corrupt data-attribute. */
const VALID_PRESETS = ["load", "video", "map", "chart", "other"] as const;
type ValidPreset = (typeof VALID_PRESETS)[number];
function isValidPreset(p: string): p is ValidPreset {
    return (VALID_PRESETS as readonly string[]).includes(p);
}

/** The three wizard steps, keyed by the DOM section they toggle. */
const STEP_SECTIONS = {
    recordings: "#feedback-step-recordings",
    report: "#feedback-step-report",
    handoff: "#feedback-post-download",
} as const;
type Step = keyof typeof STEP_SECTIONS;

function showStep(step: Step): void {
    for (const [key, sel] of Object.entries(STEP_SECTIONS)) {
        getEl(sel)?.toggleAttribute("hidden", key !== step);
    }
}

/** True once any memory card has been loaded this session (even a zero-trips
 *  drop) - i.e. the report can carry a folder layout. */
function hasLoadedCard(): boolean {
    return (state.lastIngestFiles?.length ?? 0) > 0;
}

/**
 * The byte-free folder-structure report for the current drop, or null when no
 * recordings have been loaded. Sourced from the raw ingest snapshot so it also
 * covers files that failed to become trips (the unrecognised-camera case).
 */
function cameraStructure(): string | null {
    const files = state.lastIngestFiles;
    if (!files || files.length === 0) return null;
    return buildStructureReport(files);
}

/** "Open my card": leaves the modal and triggers the normal ingest picker (the
 *  landing CTA carries the pre-ingest overlay + upload-warning flow). Shown only
 *  when no card was loaded, so a zero-content report is offered a way to fill in
 *  the file layout first. After ingest a zero-trips drop re-surfaces this flow
 *  via the no-recordings modal, now with structure. */
function loadCard(): void {
    closeFeedbackModal();
    (dom.landingDrop ?? dom.sidebarCta)?.click();
}

/** The single report .txt: header + diagnostics (as text) + folder structure. */
function buildReportText(): string {
    const parts = [REPORT_HEADER, serializeDiagnosticsText(collectDiagnostics())];
    const structure = cameraStructure();
    if (structure) parts.push(structure);
    return parts.join("\n\n");
}

function reportFilename(ts: Date): string {
    return `dashcamigo-report-${utcTimestampSlug(ts)}.txt`;
}

/** Opens the modal at step 1. Optionally pre-fills a preset (codec-unsupported -> "video", etc.). */
function openFeedbackModal(opts: { preset?: string } = {}): void {
    const m = modalEl();
    if (!m) return;
    preset = opts.preset && isValidPreset(opts.preset) ? opts.preset : null;
    downloadedReportName = null;
    hasRecordingsLink = false;

    fillPreview();
    showStep("recordings");
    // No card loaded yet -> offer to open one first (empty report otherwise).
    getEl("#feedback-noingest")?.toggleAttribute("hidden", hasLoadedCard());

    m.hidden = false;
    activateModal(m, { onClose: closeFeedbackModal, initialFocus: getEl<HTMLElement>("#feedback-recordings-yes") });
}

function closeFeedbackModal(): void {
    const m = modalEl();
    if (!m) return;
    m.hidden = true;
    deactivateModal(m);
}

/** Step 1 choice: whether the user has a recordings link, then advance to the report. */
function chooseRecordings(hasLink: boolean): void {
    hasRecordingsLink = hasLink;
    showStep("report");
    getEl<HTMLElement>("#feedback-primary")?.focus();
}

/** Fills the "what's inside" preview with the env summary and the folder
 *  structure (or a placeholder inviting the user to load recordings first). */
function fillPreview(): void {
    const body = getEl("#feedback-preview-body");
    if (!body) return;
    const structure = cameraStructure();
    const text = structure
        ? `${envSummary()}\n\n${structure}`
        : `${envSummary()}\n\n${t("feedback.report.noFilesYet")}`;
    body.textContent = text;
}

function currentSubject(): string {
    return t("feedback.subject", {
        topic: preset ? t(`feedback.step1.preset.${preset}` as never) : t("feedback.modal.title"),
    });
}

/**
 * "Download the report": builds the single .txt and saves it, then advances to
 * the hand-off (email it). The main action of step 2.
 */
function downloadReport(): void {
    const name = reportFilename(new Date());
    try {
        downloadBlob(new Blob([buildReportText()], { type: "text/plain" }), name);
        downloadedReportName = name;
        log.info("feedback report prepared", { preset, hasRecordingsLink });
    } catch (err) {
        log.error("feedback report build failed", err);
        notify({ severity: "error", messageKey: "feedback.error.reportFailed" });
        // Meta-signal: our OWN report channel failed (often an OOM). Without this
        // it never reaches us - the user cannot send the report that failed.
        captureSentryException(err, {
            fingerprint: ["feedback_report_failed", err instanceof Error ? err.name : "unknown"],
            tags: { preset: preset ?? "unknown" },
        });
        return;
    }
    const step1 = getEl("#feedback-post-download-step1");
    if (step1) step1.textContent = t("feedback.success.step1", { filename: name });
    showStep("handoff");
}

/** "Open email": a pre-filled mailto. mailto cannot attach, so the body reminds
 *  the user to attach the downloaded report (and paste a recordings link). */
function sendEmail(): void {
    const body = buildMailBody(downloadedReportName);
    // The recipient is a literal addr-spec (RFC 6068 - a bare "@", no encoding).
    // encodeURIComponent per query param, not URLSearchParams (the latter turns
    // spaces into "+", which Apple Mail shows literally).
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(currentSubject())}&body=${encodeURIComponent(body)}`;
    const win = window.open(url, "_blank");
    if (!win) {
        log.warn("mailto popup blocked, falling back to location.href");
        window.location.href = url;
    }
}

function buildMailBody(reportName: string | null): string {
    const parts: string[] = [];
    const ctx = currentContextSummary();
    if (ctx) parts.push(ctx);
    parts.push(envSummary());
    if (hasRecordingsLink) parts.push(t("feedback.recordings.mailPrompt"));
    if (reportName) {
        parts.push(t("feedback.body.attachReminder", { filename: reportName }));
    }
    // --- separator between sections for readability in plain-text mail clients.
    return parts.join("\n\n---\n");
}

/**
 * Context of what the user currently sees in the player. Without it a report like "video won't play"
 * is useless - we don't know the file, codec, or position. Even with the technical report attached,
 * many people don't read it; the email body is the first impression.
 * Returns an empty string if no trip is selected (landing / empty state).
 */
function currentContextSummary(): string {
    const af = activeFrame();
    const cand = activeCandidate();
    if (!af || !cand) return "";

    const lines: string[] = [t("feedback.body.context.title")];
    lines.push(t("feedback.body.context.file", { name: cand.file.name }));

    // Trip: start → end on the display clock (camera clock when known) + counters.
    const tripFmt = new Intl.DateTimeFormat(getDateLocale(), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
    });
    const start = tripFmt.format(displayClockDate(af.trip.startUtc, af.trip.cameraTzSec));
    const end = tripFmt.format(displayClockDate(af.trip.endUtc, af.trip.cameraTzSec));
    let filesCount = 0;
    for (const frame of af.trip.frames) {
        for (const c of Object.values(frame.channels)) {
            if (c) filesCount++;
        }
    }
    let dist = "—";
    if (af.trip.distanceKm > 0) {
        const d = formatDistanceFromKm(af.trip.distanceKm);
        dist = `${d.value.toFixed(1)} ${t(d.unitKey)}`;
    }
    lines.push(
        t("feedback.body.context.trip", {
            start,
            end,
            files: t("plurals.file", { n: filesCount }),
            distance: dist,
        }),
    );

    // Current player position. dom.player.currentTime + frame.startUtc gives trip-time.
    // Not using functions from player.ts to avoid an import cycle (player -> feedback -> player).
    const ct = dom.player?.currentTime || 0;
    // Footage-axis position: the active frame's content start + in-file offset.
    const tripPosSec = wallToContentSec(af.trip.timeline, af.frame.startUtc) + ct;
    lines.push(
        t("feedback.body.context.position", {
            pos: formatTime(tripPosSec),
            dur: formatTime(af.trip.timeline.contentDurationSec),
        }),
    );

    if (cand.codec) {
        const codecStr = cand.codecParam ? `${cand.codec} (${cand.codecParam})` : cand.codec;
        lines.push(t("feedback.body.context.codec", { codec: codecStr }));
    }
    if (cand.fingerprint) {
        lines.push(t("feedback.body.context.fingerprint", { fingerprint: cand.fingerprint }));
    }
    lines.push(
        t("feedback.body.context.layout", {
            view: isFocusLayout(state.composition.layout) ? "focus" : "split",
            channel: mainChannel(),
        }),
    );

    // If a chart selection is active, include the range - bugs often reproduce only on a specific segment.
    if (state.chartZoomed && state.chart) {
        const xScale = state.chart.scales.x;
        if (xScale && Number.isFinite(xScale.min) && Number.isFinite(xScale.max)) {
            lines.push(
                t("feedback.body.context.zoom", {
                    from: formatTime(xScale.min as number),
                    to: formatTime(xScale.max as number),
                }),
            );
        }
    }

    return lines.join("\n");
}

/** Version + UA, always included so a "try Chrome instead" response does not require follow-up questions. */
function envSummary(): string {
    return [
        t("feedback.body.env.title"),
        t("feedback.body.env.app", { version: APP_VERSION }),
        t("feedback.body.env.browser", { ua: navigator.userAgent }),
    ].join("\n");
}

export function initFeedbackModal(): void {
    const m = modalEl();
    if (!m) return;
    const entry = document.getElementById("feedback-btn");
    entry?.addEventListener("click", () => openFeedbackModal());

    // Additional entry points from error scenarios. Any button with .feedback-link
    // opens the modal; data-feedback-preset (optional) tags the subject. Delegated
    // to document to handle dynamically inserted buttons (empty-state, modals).
    document.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const link = target.closest<HTMLElement>(".feedback-link");
        if (!link) return;
        // Skip if this is the main feedback button - it has its own handler above.
        if (link.id === "feedback-btn") return;
        e.preventDefault();
        // Close the parent modal (no-recordings, unsupported, ...) - its z-index
        // would cover the feedback modal.
        const parentDialog = link.closest<HTMLElement>('[role="dialog"]');
        if (parentDialog && parentDialog.id !== "feedback-modal") {
            parentDialog.hidden = true;
            deactivateModal(parentDialog);
        }
        openFeedbackModal({ preset: link.dataset.feedbackPreset });
    });

    // Click on the backdrop (outside the card) closes the modal.
    wireBackdropDismiss(m, closeFeedbackModal, { cardSelector: ".feedback-modal-card" });
    // Escape is handled centrally by the modal manager (onClose: closeFeedbackModal).

    getEl<HTMLButtonElement>("#feedback-cancel")?.addEventListener("click", closeFeedbackModal);
    getEl<HTMLButtonElement>("#feedback-load-card")?.addEventListener("click", loadCard);
    getEl<HTMLButtonElement>("#feedback-recordings-yes")?.addEventListener("click", () => chooseRecordings(true));
    getEl<HTMLButtonElement>("#feedback-recordings-skip")?.addEventListener("click", () => chooseRecordings(false));
    getEl<HTMLButtonElement>("#feedback-primary")?.addEventListener("click", downloadReport);
    getEl<HTMLButtonElement>("#feedback-post-download-mail")?.addEventListener("click", sendEmail);
}

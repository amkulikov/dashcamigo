// Export trim bar: the clip-range control strip docked between the video and
// the timeline stack (grid area "trim" - viewer.css adds the row in export
// mode only). Owns the editable start/end time inputs (two-way synced with the
// timeline pull-tabs), the set-to-playhead buttons, the length + estimated-size
// readout, and the range actions (whole-trip reset, preview-zoom, adopt-zoom).
//
// It sits next to the visualization it controls - the pull-tabs and masks on
// #player-chart - so a range edit and its feedback happen at the point of
// action; the export panel keeps only the encode options. Every edit funnels
// through export-state (setRange / setRangeEdge - the same clamp the pull-tabs
// use) and syncs back via subscribeExportState, so the bar, the tabs and the
// panel's estimate can never disagree.

import { getSelectedRange, zoomTimelineToRange } from "./chart.js";
import { dom } from "./dom.js";
import { estimateExport, formatEstimatedSize, subscribeEncodeCeiling } from "./export-flow.js";
import { exportPanelState, setRange, setRangeEdge, subscribeExportState } from "./export-state.js";
import { formatTime } from "./format.js";
import { buildLucideIcon } from "./icons.js";
import { activeTrip, state } from "./state.js";
import { flashRangeTab } from "./timeline-range.js";
import { t } from "../i18n/index.js";
import type { I18nKey } from "../i18n/keys.js";

// Playhead accessors (player.ts getTripCurrentTime / seekTripTime / seekThenPlay),
// injected at init to keep the dep tree acyclic - player.ts must stay importable
// from here. Drive the set-to-playhead buttons, the "preview clip" seek-into-range,
// and the double-click "play the clip from its start".
let getPlayheadTripSec: () => number = () => 0;
let seekPlayheadTripSec: (sec: number) => void = () => {};
let seekThenPlayTripSec: (sec: number) => void = () => {};

// Two time inputs (start / end) two-way synced with the timeline pull-tabs,
// plus the live length readout. Refs filled by buildTrimBar, values reconciled
// by syncTrimBar. Values are content-axis seconds, formatted / parsed with
// formatTime semantics (m:ss / h:mm:ss).
let rangeStartInput: HTMLInputElement | null = null;
let rangeEndInput: HTMLInputElement | null = null;
let rangeLengthEl: HTMLElement | null = null;
// Set-to-playhead buttons flanking the inputs (the touch counterpart of the
// I/O hotkeys), the reset / preview / from-zoom action buttons, and the
// aria-live feedback line. All reconciled by syncTrimBar / syncRangeZoomBridge.
let rangeSetStartBtn: HTMLButtonElement | null = null;
let rangeSetEndBtn: HTMLButtonElement | null = null;
let rangeResetBtn: HTMLButtonElement | null = null;
let rangeUndoBtn: HTMLButtonElement | null = null;
let rangePreviewBtn: HTMLButtonElement | null = null;
let rangeFromZoomBtn: HTMLButtonElement | null = null;
let rangeFeedbackEl: HTMLElement | null = null;
let rangeFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

/** Snapshot of the range the whole-trip reset just discarded, powering the
 *  one-level Undo. Cleared the moment the range diverges from the full span
 *  again (manual re-trim) or the range identity changes (trip switch), so a
 *  stale selection from another context can never be restored. */
let undoRange: { startTripSec: number; endTripSec: number } | null = null;

/** How close (sec) the playhead may sit to the clip end before "Preview clip"
 *  treats it as "parked at the end" and rewinds to the clip start. Covers the
 *  natural state right after the set-end-to-playhead action, where pressing
 *  play would hit the stop-at-end boundary instantly (a visible "twitch"). */
const PREVIEW_END_REWIND_SEC = 1;

/** Lucide "arrow-down-to-line": a marker dropping onto a line - "put this clip
 *  edge at the playhead". Shared by both set-to-playhead buttons. */
const SET_EDGE_ICON_PATHS = ["M12 17V3", "m6 11 6 6 6-6", "M19 21H5"];

/**
 * Wires the trim bar: builds the controls into the static #export-trim-bar
 * container and subscribes to the export-state bus. Must be called once on
 * startup, after dom.ts resolved the refs. The bar is [hidden] outside export
 * mode / outside the options phase - syncTrimBar owns that flag.
 */
export function initExportTrimBar(opts: {
    getTripCurrentTime: () => number;
    seekTripTime: (sec: number) => void;
    seekThenPlay: (sec: number) => void;
}): void {
    getPlayheadTripSec = opts.getTripCurrentTime;
    seekPlayheadTripSec = opts.seekTripTime;
    seekThenPlayTripSec = opts.seekThenPlay;
    buildTrimBar();
    subscribeExportState(syncTrimBar);
    // The device encode ceiling resolves asynchronously (a WebCodecs probe) and
    // lands outside the state bus - refresh the size readout when it does.
    subscribeEncodeCeiling(syncTrimLength);
    syncTrimBar();
}

/**
 * Builds the bar's controls. Replaces the export panel's old passive readout
 * line: the range controls now live at the timeline they edit, so there is no
 * "you can also drag the handles" hint - the handles are right below.
 */
function buildTrimBar(): void {
    const bar = dom.exportTrimBar;
    if (!bar) return;
    bar.innerHTML = "";

    const row = document.createElement("div");
    row.className = "export-trim-bar__row";

    rangeSetStartBtn = makeSetEdgeButton("start", t("export.range.setStart"));
    rangeStartInput = makeRangeInput("start", t("export.range.startLabel"));

    const sep = document.createElement("span");
    sep.className = "export-trim-bar__sep";
    sep.textContent = "→";
    sep.setAttribute("aria-hidden", "true");

    rangeEndInput = makeRangeInput("end", t("export.range.endLabel"));
    rangeSetEndBtn = makeSetEdgeButton("end", t("export.range.setEnd"));

    const length = document.createElement("span");
    length.className = "export-trim-bar__length";
    rangeLengthEl = length;

    row.appendChild(rangeSetStartBtn);
    row.appendChild(rangeStartInput);
    row.appendChild(sep);
    row.appendChild(rangeEndInput);
    row.appendChild(rangeSetEndBtn);
    row.appendChild(length);

    // Range actions: reset to the full trip (shown only when narrowed), zoom
    // the timeline to the clip (playback then stays inside it - a preview),
    // and adopt the current zoom window as the clip (shown only when zoomed).
    // Inside the same row, pushed to the trailing edge; they wrap under the
    // inputs on narrow widths.
    const actions = document.createElement("div");
    actions.className = "export-trim-bar__actions";

    rangeResetBtn = document.createElement("button");
    rangeResetBtn.type = "button";
    rangeResetBtn.id = "export-trim-reset";
    rangeResetBtn.className = "export-trim-bar__action";
    rangeResetBtn.textContent = t("export.range.reset");
    rangeResetBtn.hidden = true;
    rangeResetBtn.addEventListener("click", () => {
        const trip = activeTrip();
        const range = exportPanelState.range;
        if (!trip || !range) return;
        // Keep the discarded selection for Undo BEFORE the reset: setRange
        // notifies synchronously, so syncTrimBar shows the Undo button in the
        // same tick the reset lands. One accidental click on "Whole trip" no
        // longer destroys a carefully tuned range.
        undoRange = { startTripSec: range.startTripSec, endTripSec: range.endTripSec };
        // In-place via the shared setter: replacing the range identity is
        // reserved for trip switches (syncTrimBar reads it as "discard stale
        // input text" + "announce the reset").
        setRange(0, trip.timeline.contentDurationSec);
        // The button just hid itself (nothing left to reset) and a focused
        // hidden element silently drops focus to <body> - park a keyboard
        // user on the neighbor action instead. A button, not the time input:
        // focusing an input would pop the keyboard on mobile. Undo first: it
        // is the likeliest next action after a reset (and the mis-click cure).
        if (document.activeElement === document.body) (rangeUndoBtn ?? rangePreviewBtn)?.focus();
    });
    actions.appendChild(rangeResetBtn);

    rangeUndoBtn = document.createElement("button");
    rangeUndoBtn.type = "button";
    rangeUndoBtn.id = "export-trim-undo";
    rangeUndoBtn.className = "export-trim-bar__action";
    rangeUndoBtn.textContent = t("export.range.undo");
    rangeUndoBtn.title = t("export.range.undoTitle");
    rangeUndoBtn.hidden = true;
    rangeUndoBtn.addEventListener("click", () => {
        const saved = undoRange;
        if (!saved) return;
        undoRange = null;
        setRange(saved.startTripSec, saved.endTripSec);
        // Both edges just jumped back - flash them so the restore is visible
        // beyond the masks snapping (same feedback as the set-to-playhead paths).
        flashRangeTab("start");
        flashRangeTab("end");
        // Mirror of the reset's focus parking: this button hides after
        // restoring, so a keyboard user lands on the reset (now shown again).
        if (document.activeElement === document.body) (rangeResetBtn ?? rangePreviewBtn)?.focus();
    });
    actions.appendChild(rangeUndoBtn);

    // from-zoom is built (and appended) BEFORE preview so preview stays the
    // rightmost action. The actions row is right-anchored (margin-left:auto), so
    // the last child sits at a fixed edge: revealing from-zoom on the first
    // preview click grows the row leftward and does NOT shift preview - otherwise
    // the button slides out from under a double-click's second press.
    rangeFromZoomBtn = document.createElement("button");
    rangeFromZoomBtn.type = "button";
    rangeFromZoomBtn.id = "export-trim-from-zoom";
    rangeFromZoomBtn.className = "export-trim-bar__action";
    rangeFromZoomBtn.textContent = t("export.range.fromZoom");
    rangeFromZoomBtn.title = t("export.range.fromZoomTitle");
    rangeFromZoomBtn.hidden = true;
    rangeFromZoomBtn.addEventListener("click", () => {
        const sel = getSelectedRange();
        if (!sel) return;
        setRange(sel.startTripSec, sel.endTripSec);
    });
    actions.appendChild(rangeFromZoomBtn);

    rangePreviewBtn = document.createElement("button");
    rangePreviewBtn.type = "button";
    rangePreviewBtn.id = "export-trim-preview";
    rangePreviewBtn.className = "export-trim-bar__action";
    rangePreviewBtn.textContent = t("export.range.zoomToClip");
    rangePreviewBtn.title = t("export.range.zoomToClipTitle");
    rangePreviewBtn.addEventListener("click", () => {
        const range = exportPanelState.range;
        if (!range) return;
        // Zooming the timeline to the clip window makes the existing zoom
        // machinery bound playback to it (seek clamp + stop/loop at the end),
        // so Space now plays exactly the clip - a preview with no new player
        // code. Z / chart double-click resets the zoom and unclamps.
        zoomTimelineToRange(range.startTripSec, range.endTripSec);
        // Land the playhead on the clip start when it is outside the clip OR
        // parked at/near the clip end (where play would stop instantly);
        // genuinely mid-clip positions are left alone (resuming a scrub-through).
        const cur = getPlayheadTripSec();
        if (cur < range.startTripSec - 0.05 || cur > range.endTripSec - PREVIEW_END_REWIND_SEC) {
            seekPlayheadTripSec(range.startTripSec);
        }
    });
    // Double-click: zoom to the clip AND play it from the start. seekThenPlay
    // defers play() to the landing 'seeked' so a cross-file seek to the clip
    // start does not race the reload (see player.ts). The two single 'click's
    // that precede this already applied the zoom + rewind; this re-asserts the
    // start-seek even from a genuinely mid-clip playhead, then plays.
    rangePreviewBtn.addEventListener("dblclick", () => {
        const range = exportPanelState.range;
        if (!range) return;
        zoomTimelineToRange(range.startTripSec, range.endTripSec);
        seekThenPlayTripSec(range.startTripSec);
    });
    actions.appendChild(rangePreviewBtn);

    row.appendChild(actions);
    bar.appendChild(row);

    // One polite live region for every transient range message (invalid input,
    // the 1s minimum, the trip-switch reset). Text-only: emptied rather than
    // hidden so screen readers keep announcing changes.
    const feedback = document.createElement("div");
    feedback.className = "export-trim-bar__feedback";
    feedback.setAttribute("aria-live", "polite");
    rangeFeedbackEl = feedback;
    bar.appendChild(feedback);
}

/** One set-to-playhead icon button. Same funnel as the I/O hotkeys: the shared
 *  clamp absorbs an edge crossing, the tab flash marks what moved. */
function makeSetEdgeButton(which: "start" | "end", label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "export-trim-bar__set";
    btn.dataset.setEdge = which;
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.appendChild(buildLucideIcon(SET_EDGE_ICON_PATHS, 14));
    btn.addEventListener("click", () => {
        if (!exportPanelState.range) return;
        const res = setRangeEdge(which, getPlayheadTripSec());
        flashRangeTab(which);
        if (res.clampedToMinLength) showRangeFeedback("minLength");
    });
    return btn;
}

/** Transient range feedback kinds; each maps to one i18n string. */
type RangeFeedbackKind = "invalid" | "minLength" | "resetForTrip";

/** Writes a transient message into the feedback live region. Error tone only
 *  for invalid input; the clamps are information, not mistakes. */
function showRangeFeedback(kind: RangeFeedbackKind): void {
    if (!rangeFeedbackEl) return;
    const key: I18nKey =
        kind === "invalid"
            ? "export.range.invalidTime"
            : kind === "minLength"
              ? "export.range.minLength"
              : "export.range.resetNote";
    rangeFeedbackEl.textContent = t(key);
    rangeFeedbackEl.classList.toggle("is-error", kind === "invalid");
    if (rangeFeedbackTimer) clearTimeout(rangeFeedbackTimer);
    rangeFeedbackTimer = setTimeout(() => {
        if (rangeFeedbackEl) rangeFeedbackEl.textContent = "";
    }, RANGE_FEEDBACK_MS);
}

/** How long a transient range message (and the matching input outline) lives. */
const RANGE_FEEDBACK_MS = 5000;

/** Pending auto-clear timers for the invalid markers, one per input. */
const invalidClearTimers = new Map<HTMLInputElement, ReturnType<typeof setTimeout>>();

/** Marks an input as invalid with a brief shake (CSS honors reduced-motion).
 *  The markers are transient like the feedback message - they expire together
 *  (RANGE_FEEDBACK_MS) so the outline can never outlive the explanation. They
 *  cannot clear on "field shows the authoritative value": the Enter handler
 *  blurs right after the revert, and that blur re-commits the reverted text -
 *  clearing there would kill the outline in the same tick it was shown. */
function flashInvalidRangeInput(input: HTMLInputElement): void {
    input.setAttribute("aria-invalid", "true");
    input.classList.remove("is-invalid");
    // Reflow so re-adding the class restarts the animation on rapid repeats.
    void input.offsetWidth;
    input.classList.add("is-invalid");
    const prev = invalidClearTimers.get(input);
    if (prev) clearTimeout(prev);
    invalidClearTimers.set(
        input,
        setTimeout(() => clearInvalidRangeInput(input), RANGE_FEEDBACK_MS),
    );
}

/** Removes the invalid markers immediately (valid commit, nudge) and cancels
 *  the pending expiry. */
function clearInvalidRangeInput(input: HTMLInputElement): void {
    const timer = invalidClearTimers.get(input);
    if (timer) {
        clearTimeout(timer);
        invalidClearTimers.delete(input);
    }
    input.removeAttribute("aria-invalid");
    input.classList.remove("is-invalid");
}

/**
 * Reconciles the from-zoom bridge button with the chart-zoom state. Split from
 * syncTrimBar because zoom changes do not tick the export-state bus - the
 * chart's onSelectionChange callback (trip-ui-init) calls this directly.
 */
export function syncRangeZoomBridge(): void {
    if (!rangeFromZoomBtn) return;
    rangeFromZoomBtn.hidden = getSelectedRange() === null;
}

/** One range time <input>. Commits on Enter and blur; Escape reverts to the
 *  current value; ArrowUp/Down nudge the edge by 1s (Shift = 10s). The commit
 *  funnels through setRangeEdge (the same clamp the drag-tabs use), so the
 *  tabs, masks, chart shading and estimate all follow. */
function makeRangeInput(which: "start" | "end", ariaLabel: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    // Time codes are digits + ":". "text" keeps the colon reachable on mobile;
    // a bare "numeric" keyboard hides it on some phones.
    input.inputMode = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className = "export-trim-bar__input";
    input.dataset.rangeEdge = which;
    input.setAttribute("aria-label", ariaLabel);
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            commitRangeInput(input, which);
            input.blur();
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            input.value = formatEdge(which);
            input.blur();
        } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
            // Left/Right stay caret movement; only Up/Down nudge.
            ev.preventDefault();
            // Commit typed text first so the nudge starts from what the user sees.
            commitRangeInput(input, which);
            const range = exportPanelState.range;
            if (!range) return;
            const step = (ev.shiftKey ? 10 : 1) * (ev.key === "ArrowUp" ? 1 : -1);
            const cur = which === "start" ? range.startTripSec : range.endTripSec;
            // Whole-second grid: repeated presses land on clean values, and a
            // drag-set fractional edge (invisible - the display floors) is
            // deliberately collapsed to a round second by the first nudge.
            const res = setRangeEdge(which, Math.round(cur) + step);
            if (res.clampedToMinLength) showRangeFeedback("minLength");
            input.value = formatEdge(which);
            // The nudge always ends on an authoritative value, even when the
            // pre-nudge text was garbage that commitRangeInput just flagged.
            clearInvalidRangeInput(input);
        }
    });
    input.addEventListener("blur", () => commitRangeInput(input, which));
    return input;
}

/** Current formatted value of a range edge, or "" when no range is set. */
function formatEdge(which: "start" | "end"): string {
    const range = exportPanelState.range;
    if (!range) return "";
    return formatTime(which === "start" ? range.startTripSec : range.endTripSec);
}

/**
 * Parses a clip-time string into content-axis seconds. Accepts "h:mm:ss",
 * "m:ss" and plain seconds ("90"), lenient about leading zeros and surrounding
 * whitespace. Returns null on anything unparseable (empty, a non-numeric field,
 * more than three colon groups) so the caller reverts to the current value
 * without a dialog. Inverse of formatTime's m:ss / h:mm:ss output.
 */
function parseClipTime(text: string): number | null {
    const parts = text.trim().split(":");
    if (parts.length > 3) return null;
    let total = 0;
    for (const part of parts) {
        const field = part.trim();
        // Each colon group is a non-negative integer; a lone group is a plain
        // seconds count. Leading zeros are fine (Number("07") === 7).
        if (!/^\d+$/.test(field)) return null;
        total = total * 60 + Number(field);
    }
    return total;
}

/** Commits an input's text to the range, or reverts on invalid input. Always
 *  ends with the input showing the authoritative (clamped) value. Invalid text
 *  and a min-length collision surface in the feedback line - the revert used
 *  to be fully silent, which read as the edit just vanishing. */
function commitRangeInput(input: HTMLInputElement, which: "start" | "end"): void {
    if (!exportPanelState.range) return;
    // Unchanged text is a true no-op. Without this guard a plain focus+blur (or
    // Escape, which resets the text before blurring) would re-parse the FLOORED
    // display value and silently shave the fractional seconds off the stored
    // edge (e.g. a 62.36s trip end truncating to 62.0 on cancel).
    if (input.value.trim() === formatEdge(which)) {
        input.value = formatEdge(which);
        return;
    }
    const parsed = parseClipTime(input.value);
    // Valid -> clamp + notify via the shared edge setter; invalid -> leave the
    // range untouched, say why, and revert the text below.
    if (parsed !== null) {
        clearInvalidRangeInput(input);
        const res = setRangeEdge(which, parsed);
        if (res.clampedToMinLength) showRangeFeedback("minLength");
    } else {
        flashInvalidRangeInput(input);
        showRangeFeedback("invalid");
    }
    // Reflect the current value: the clamped commit, or the pre-edit value on
    // invalid text. Also covers syncTrimBar's focused-input skip.
    input.value = formatEdge(which);
}

/** The range object the inputs were last synced from. setRangeEdge mutates the
 *  range in place, so a new identity means resetExportRangeForTrip replaced it
 *  (trip switch) - the one case where in-progress typing must be discarded. */
let lastSyncedRange: object | null = null;
/** Whether the last-synced range was narrower than its trip. Snapshot taken
 *  BEFORE a trip switch replaces the range, so the switch can tell "the reset
 *  just discarded a real selection" (announce it) from a full-span no-op. */
let prevRangeWasNarrowed = false;

/** Sub-second slack when comparing a range against the full trip span: stored
 *  edges keep drag precision, so a strict comparison would misread an
 *  effectively-full range as narrowed. */
const FULL_SPAN_EPSILON_SEC = 0.5;

/**
 * Reconciles the whole bar from exportPanelState on every state tick: the
 * bar's visibility, the two inputs, their enabled state, and the length
 * readout. Never clobbers text the user is mid-edit on (focus guard) so a tab
 * drag or estimate refresh does not overwrite in-progress typing.
 */
function syncTrimBar(): void {
    // Visible only while configuring: the options phase hides during an export
    // run (progress/done/error), and the numeric edits must hide with it - the
    // running export already snapshotted its range.
    if (dom.exportTrimBar) {
        dom.exportTrimBar.hidden = !(state.exportModeOpen && exportPanelState.phase === "options");
    }

    const trip = activeTrip();
    const range = exportPanelState.range;
    const hasRange = !!(trip && range);
    // Trip switched under a focused input (auto-advance at trip end): its text
    // belongs to the PREVIOUS trip, and a later blur would commit it into the
    // new trip's range. Force-sync past the focus guard in that case.
    const rangeReplaced = range !== lastSyncedRange;
    // The reset just replaced a genuinely narrowed selection while the bar
    // was shown - without a word the trimmed clip silently becomes the whole
    // trip. lastSyncedRange !== null skips the first-open seeding.
    if (rangeReplaced && lastSyncedRange !== null && prevRangeWasNarrowed && state.exportModeOpen) {
        showRangeFeedback("resetForTrip");
    }
    lastSyncedRange = range;

    for (const [input, which] of [
        [rangeStartInput, "start"],
        [rangeEndInput, "end"],
    ] as const) {
        if (!input) continue;
        input.disabled = !hasRange;
        // Focus/dirty guard: skip the field the user is typing into.
        if (!rangeReplaced && document.activeElement === input) continue;
        input.value = hasRange ? formatEdge(which) : "";
    }

    const narrowed =
        hasRange &&
        (range.startTripSec > FULL_SPAN_EPSILON_SEC ||
            range.endTripSec < trip.timeline.contentDurationSec - FULL_SPAN_EPSILON_SEC);
    prevRangeWasNarrowed = narrowed;

    // The undo snapshot only survives the "just reset to full span" state: a
    // trip switch invalidates it (another trip's seconds), and a manual
    // re-trim supersedes it (the user has a new selection to protect).
    if (rangeReplaced || narrowed) undoRange = null;

    // The set-to-playhead / preview buttons need a range to act on; the reset
    // additionally only earns its place when there is something to reset - its
    // very appearance signals "you have trimmed something". Preview hides
    // (not just disables) without a range so the whole actions cluster
    // collapses via the :has() rule instead of showing a lone dead button.
    if (rangeSetStartBtn) rangeSetStartBtn.disabled = !hasRange;
    if (rangeSetEndBtn) rangeSetEndBtn.disabled = !hasRange;
    if (rangePreviewBtn) rangePreviewBtn.hidden = !hasRange;
    if (rangeResetBtn) rangeResetBtn.hidden = !narrowed;
    if (rangeUndoBtn) rangeUndoBtn.hidden = !hasRange || undoRange === null;
    syncRangeZoomBridge();
    syncTrimLength();
}

/**
 * Length readout + the estimated output size at the point of action: trimming
 * exists to control exactly that number, so it lives next to the handles. The
 * size half is video-mode only, gated HERE and not just at the caller: the
 * encode-ceiling probe lands async straight into this sync
 * (subscribeEncodeCeiling), and a probe started in video mode can land after
 * the user switched to gpx - without the gate it would stamp a video byte-size
 * onto the track-only readout. Same estimateExport() the panel's estimate
 * block reads, so the two figures cannot disagree.
 */
function syncTrimLength(): void {
    if (!rangeLengthEl) return;
    const trip = activeTrip();
    const range = exportPanelState.range;
    if (!trip || !range) {
        // No range yet: on an active trip stay blank (the inputs are disabled
        // placeholders), otherwise name the missing precondition.
        rangeLengthEl.textContent = trip ? "" : t("export.range.noTrip");
        return;
    }
    const span = Math.max(0, range.endTripSec - range.startTripSec);
    let text = t("export.range.length", { span: formatTime(span) });
    if (exportPanelState.outputKind === "video") {
        const est = estimateExport();
        if (est) text += ` · ${formatEstimatedSize(est)}`;
    }
    rangeLengthEl.textContent = text;
}

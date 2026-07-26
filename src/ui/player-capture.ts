// Capture current video frame as a JPG via canvas (not an OS screenshot -
// player UI is excluded). The button + the S hotkey both call captureCurrentFrame.
// Filename: dashcamigo_YYYYMMDD_HHMMSS_frame.jpg in the user's local TZ.

import { resolveRegionBlursAt } from "../blur-regions.js";
import { downloadBlob } from "../download.js";
import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { createRegionBlurHelper, paintRegionBlursForView } from "../transcode/compose.js";
import { activeBlurRegions } from "./blur-regions-state.js";
import { activePlayer, effectiveMasterChannel, dom } from "./dom.js";
import { activeCandidate, state } from "./state.js";

const log = createLogger("player");

/**
 * Saves the current <video> frame as a JPG. Waits up to 1500ms for
 * readyState >= HAVE_CURRENT_DATA if src changed recently (drag-zoom selection
 * landing on a new frame, just-switched trip) - without that wait the button
 * appeared dead.
 *
 * `getTripStartUtcSec` resolves the active trip's start; like
 * `getTripCurrentSec` it is invoked AFTER all readiness awaits + rVFC ack so
 * the filename matches the frame actually drawn, not the moment of click
 * (which can drift by up to ~1.75s if the readyState wait kicks in - long
 * enough for the user to switch trips, and a click-time startUtc paired with
 * the new trip's seconds produced a nonsense timestamp).
 *
 * Both passed in instead of imported so this module does not pull in the
 * rest of the playback graph.
 */
export async function captureCurrentFrame(
    getTripStartUtcSec: () => number | null,
    getTripCurrentSec: () => number,
): Promise<void> {
    const video = activePlayer();
    // One snapshot log per attempt so users can share "pressed S, nothing
    // downloaded" reports and the cause is immediately visible. Without it
    // early returns are silent and unreproducible.
    //
    // effectiveMasterChannel(), NOT mainChannel(): the drawn frame comes from
    // activePlayer() = channelPlayers[effectiveMasterChannel()], which falls
    // back to another present camera when the main channel has a gap at the
    // playhead. Resolving blur regions against mainChannel() there would redact
    // the WRONG camera - the drawn (fallback) camera's marked plate ships
    // unredacted, and the main camera's regions paint at the wrong spots. The
    // region channel must equal the drawn element's channel.
    const ch = effectiveMasterChannel();
    const ctxLog = {
        channel: ch,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: video.currentTime,
        paused: video.paused,
        hasMse: !!state.channelBackends[ch],
        chartZoomed: state.chartZoomed,
    };
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        const ready = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                cleanup();
                resolve(false);
            }, 1500);
            const onReady = (): void => {
                if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
                    cleanup();
                    resolve(true);
                }
            };
            const cleanup = (): void => {
                clearTimeout(timer);
                video.removeEventListener("loadeddata", onReady);
                video.removeEventListener("canplay", onReady);
                video.removeEventListener("loadedmetadata", onReady);
            };
            video.addEventListener("loadeddata", onReady);
            video.addEventListener("canplay", onReady);
            video.addEventListener("loadedmetadata", onReady);
        });
        if (!ready) {
            log.warn("capture skipped: video not ready after wait", ctxLog);
            return;
        }
    }

    // After a channel swap the former slave may be in throttled decoding
    // (muted background tile - the browser defers decoding). Nudge currentTime
    // to force a decode of the current frame and confirm via
    // requestVideoFrameCallback. Without this drawImage gives a black or
    // stale frame.
    if (typeof video.requestVideoFrameCallback === "function") {
        // Intentionally self-assign currentTime to force the throttled
        // decoder to drop the stale frame and decode the current one.
        // biome-ignore lint/correctness/noSelfAssign: see comment above.
        video.currentTime = video.currentTime;
        const frameAck = await new Promise<"callback" | "timeout">((resolve) => {
            // 250ms timeout in case the callback doesn't fire (paused +
            // currentTime= sometimes doesn't trigger a new frame).
            const timer = setTimeout(() => resolve("timeout"), 250);
            video.requestVideoFrameCallback(() => {
                clearTimeout(timer);
                resolve("callback");
            });
        });
        if (frameAck === "timeout") {
            log.debug("capture: rVFC timeout, drawing last decoded frame", ctxLog);
        }
    }

    // The active element may have been swapped during the readiness/rVFC awaits
    // (user switched trip or channel, or a preload slot promotion). Drawing from
    // the stale `video` would capture a black/wrong-trip frame under a filename
    // resolved post-await for the NEW trip. Bail; capture is a manual action, the
    // user can retry on the live element.
    if (activePlayer() !== video) {
        log.warn("capture skipped: active video changed during readiness wait", ctxLog);
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        log.warn("capture skipped: 2d context unavailable", ctxLog);
        return;
    }
    try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
        // SecurityError if video is tainted (cross-origin without CORS) - our
        // blob: src should never trigger this, but log defensively.
        log.error("capture failed: drawImage threw", e);
        return;
    }

    // Blur zones: in export-mode the tiles preview the redaction, so the
    // captured JPG must match - otherwise S quietly saves the very plate the
    // user just covered. Identity view: raw source frame -> same-size canvas.
    if (state.exportModeOpen) {
        const regionBlurs = resolveRegionBlursAt(activeBlurRegions(), ch, getTripCurrentSec());
        if (regionBlurs.length > 0) {
            paintRegionBlursForView(
                ctx,
                regionBlurs,
                canvas.width,
                canvas.height,
                0,
                0,
                canvas.width,
                canvas.height,
                0,
                0,
                canvas.width,
                canvas.height,
                createRegionBlurHelper(),
            );
        }
    }

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
        log.warn("capture skipped: toBlob returned null", { ...ctxLog, canvasW: canvas.width, canvasH: canvas.height });
        return;
    }

    // Snapshot trip anchor + trip-current AFTER awaits: filename now matches
    // the frame drawn above, not the click instant (which could be far behind
    // on a slow readyState wait - or even a different trip).
    const filename = makeFrameFilename(getTripStartUtcSec(), getTripCurrentSec());
    downloadBlob(blob, filename);
    log.info("capture saved", { filename, bytes: blob.size, ...ctxLog });
}

/**
 * Filename for a captured frame. Timestamp = tripStartUtcSec + tripCurrentSec
 * formatted in the user's local TZ (same as trip headers in the sidebar).
 * Falls back to system time when there is no active trip.
 */
function makeFrameFilename(tripStartUtcSec: number | null, tripCurrentSec: number): string {
    const unixSec = tripStartUtcSec !== null ? tripStartUtcSec + tripCurrentSec : Date.now() / 1000;
    const d = new Date(unixSec * 1000);
    const yy = d.getFullYear().toString().padStart(4, "0");
    const mo = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    const hh = d.getHours().toString().padStart(2, "0");
    const mi = d.getMinutes().toString().padStart(2, "0");
    const ss = d.getSeconds().toString().padStart(2, "0");
    return `dashcamigo_${yy}${mo}${dd}_${hh}${mi}${ss}_frame.jpg`;
}

/**
 * Syncs the capture button state: disabled when there is no active video or
 * when the selected VideoCandidate has canPlay=false. readyState is not
 * checked - captureCurrentFrame waits for loadeddata itself; without that the
 * button would flicker disabled on every src change.
 */
export function syncCaptureButton(): void {
    const btn = dom.playerBar.capture;
    if (!state.active) {
        btn.disabled = true;
        btn.title = t("player.captureDisabled.noTrip");
        return;
    }
    const video = activeCandidate();
    if (video && !video.canPlay) {
        btn.disabled = true;
        btn.title = t("player.captureDisabled.codec", { codec: video.codec ?? "?" });
        return;
    }
    btn.disabled = false;
    btn.title = t("player.capture");
}

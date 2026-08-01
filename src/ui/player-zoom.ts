// Digital zoom on the active video tile + birds-eye mini-preview with a
// viewport frame. Works only in focus mode, including fullscreen. Resets on
// trip change, channel swap, focus<->split toggle. Min scale = 1, max = 8.
//
// Owns: state.videoZoom geometry + offsets (read/written here),
// mainDrag/minimapDrag local pointer state, the two-finger pinch gesture (touch
// equivalent of wheel zoom), the wasDragging click-suppression flag, and the
// mini-preview <video> sync (separate decoder, mirrors master currentTime /
// play / pause / rate).
//
// Boundary: zoom does not touch the master <video>.src. The mini-preview's
// src goes through setVideoSrcFromFile (player-video-src) - same blob URL
// management as the main pipeline. requiresMseBackend gates the mini-map:
// HEVC remux / MPEG-TS files have no native-decodable blob URL, so the
// duplicate <video> cannot play them - we hide the mini-preview instead.

import { containRect } from "./video-geometry.js";
import {
    ALL_CHANNELS,
    activePlayer,
    channelTileFor,
    dom,
    forEachVideoSlot,
    onActivePlayerEvent,
    SLAVE_DRIFT_MAX_SEC,
} from "./dom.js";
import { t } from "../i18n/index.js";
import { isMobileLayout } from "./media-queries.js";
import { clearVideoSrc, requiresMseBackend, setVideoSrcFromFile, videoAttachedFile } from "./player-video-src.js";
import { activeCandidate, isFocusLayout, state } from "./state.js";

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_WHEEL_FACTOR = 1.15;
const DRAG_PIXEL_THRESHOLD = 5;

/** Active pointer-drag on the main video (pan). */
interface MainDragState {
    pointerId: number;
    target: HTMLElement;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    maxDist: number;
}
let mainDrag: MainDragState | null = null;
// "drag just ended" flag - checked first in the main video click handler so a
// pointerup-after-drag doesn't toggle play/pause. PointerEvents fire BEFORE
// click, so the flag is set in time. Cleared by the click handler itself
// (via consumeDragClickSuppress).
let wasDragging = false;

/** Active pointer-drag on the mini-preview (pan via minimap). */
interface MinimapDragState {
    pointerId: number;
}
let minimapDrag: MinimapDragState | null = null;

// Two-finger pinch zoom (the touch entry point that wheel zoom has on desktop).
// activePointers tracks every contact currently on the active video so a second
// finger can promote a single touch into a pinch; pinch holds the gesture-start
// snapshot. Both are cleared on resetVideoZoom (trip change / channel swap).
const activePointers = new Map<number, { x: number; y: number }>();
interface PinchState {
    startDist: number;
    startScale: number;
    startOffsetX: number;
    startOffsetY: number;
    // Pinch centroid at gesture start, in tile (untransformed) coordinates.
    startCentroidX: number;
    startCentroidY: number;
}
let pinch: PinchState | null = null;
// A pinch (unlike a pan) often does NOT synthesize a trailing click, so we can't
// rely on the click to consume the wasDragging flag. This self-clearing timer
// drops the flag if no click arrives, so a pinch never eats the next real tap.
let pinchClickSuppressTimer = 0;

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Geometry of the rendered frame inside the active tile, accounting for
 * object-fit:contain. Returns null when the video is not loaded yet
 * (videoWidth=0) or there is no active trip.
 */
interface FrameGeometry {
    tile: HTMLElement;
    video: HTMLVideoElement;
    tileW: number;
    tileH: number;
    vW: number;
    vH: number;
    fit: number;
    dispW: number;
    dispH: number;
    padX: number;
    padY: number;
}

function computeZoomGeometry(): FrameGeometry | null {
    if (!state.active) return null;
    if (!isFocusLayout(state.composition.layout)) return null;
    const video = activePlayer();
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (vW <= 0 || vH <= 0) return null;
    const tile = video.parentElement;
    if (!tile) return null;
    const tileW = tile.clientWidth;
    const tileH = tile.clientHeight;
    if (tileW <= 0 || tileH <= 0) return null;
    // Shared contain-fit math (same rect the crop editor uses) - keeps zoom
    // and crop geometry from drifting apart.
    const disp = containRect(vW / vH, tileW, tileH);
    return {
        tile,
        video,
        tileW,
        tileH,
        vW,
        vH,
        fit: disp.w / vW,
        dispW: disp.w,
        dispH: disp.h,
        padX: disp.x,
        padY: disp.y,
    };
}

/**
 * Clamps the zoom offset so the displayed frame ALWAYS covers the full tile
 * at the current scale (no tile background visible at corners).
 * Min/max derived from:
 *   left  = padX*scale + offsetX <= 0       -> offsetX <= -padX*scale
 *   right = (padX+dispW)*scale + offsetX >= tileW -> offsetX >= tileW - (padX+dispW)*scale
 */
function clampZoomOffset(g: FrameGeometry, scale: number, offsetX: number, offsetY: number): { x: number; y: number } {
    const minX = g.tileW - (g.padX + g.dispW) * scale;
    const maxX = -g.padX * scale;
    const minY = g.tileH - (g.padY + g.dispH) * scale;
    const maxY = -g.padY * scale;
    // At scale=1 minX===maxX (=-padX), obvious no-pan. Standard clamp after that.
    return {
        x: clamp(offsetX, Math.min(minX, maxX), Math.max(minX, maxX)),
        y: clamp(offsetY, Math.min(minY, maxY), Math.max(minY, maxY)),
    };
}

/**
 * Applies state.videoZoom to the active video (inline transform) and
 * surrounding UI (.zoomed class on tile, minimap sync). Idempotent: safe to
 * call after any videoZoom or layout change.
 */
export function applyVideoZoom(): void {
    // Badge sync runs first so it is hidden in export mode too (the early return
    // below would otherwise leave a stale badge on screen).
    syncZoomBadge();
    // In export mode the crop preview owns the main-video transform (player-crop
    // writes the same video.style.transform). Bail so this never resets/overwrites
    // it - including from the ResizeObserver below. Digital zoom is a casual
    // viewing aid; export mode is for configuring the output.
    if (state.exportModeOpen) return;
    const z = state.videoZoom;
    // Reset all slots + tiles (8 videos, 4 tiles). Apply zoom only to the
    // active master <video> and its tile. Two-pass is simpler than computing
    // "keep or reset" in one pass.
    forEachVideoSlot((v) => {
        v.style.transform = "";
    });
    for (const ch of ALL_CHANNELS) {
        channelTileFor(ch).classList.remove("zoomed");
    }
    if (z.scale > 1) {
        const master = activePlayer();
        master.style.transformOrigin = "0 0";
        master.style.transform = `translate(${z.offsetX}px, ${z.offsetY}px) scale(${z.scale})`;
        master.parentElement?.classList.add("zoomed");
    }
    syncMinimap();
}

/** Reset zoom to default and clear all artifacts. Idempotent. */
export function resetVideoZoom(): void {
    state.videoZoom = { scale: 1, offsetX: 0, offsetY: 0 };
    // Release any active drag.
    if (mainDrag) {
        try {
            mainDrag.target.releasePointerCapture(mainDrag.pointerId);
        } catch {
            // pointer may have already been released by the browser - ok.
        }
        mainDrag.target.classList.remove("dragging");
        mainDrag = null;
    }
    if (minimapDrag) {
        try {
            dom.videoMinimap.releasePointerCapture(minimapDrag.pointerId);
        } catch {
            /* pointer may have already been released by the browser */
        }
        minimapDrag = null;
    }
    // Release any in-flight pinch + its captured pointers.
    for (const id of activePointers.keys()) {
        try {
            dom.videoGrid.releasePointerCapture(id);
        } catch {
            /* pointer may have already been released by the browser */
        }
    }
    activePointers.clear();
    pinch = null;
    if (pinchClickSuppressTimer) {
        clearTimeout(pinchClickSuppressTimer);
        pinchClickSuppressTimer = 0;
    }
    wasDragging = false;
    applyVideoZoom();
    // Release the minimap's decoder and blob URL - shouldn't burn resources
    // while zoom is inactive. On the next zoom-in, src will be re-applied via
    // setVideoSrcFromFile.
    if (dom.videoMinimapVideo.src) clearVideoSrc(dom.videoMinimapVideo);
}

// Zoom-level badge + reset control on the active tile (top-left, away from the
// top-right minimap). It is the visible cue a hidden gesture (wheel/pinch) needs
// and - critically - the ONLY way to leave zoom on touch, where Z is unavailable
// and pinching back out is fiddly. Lazily built; removed from the DOM when not
// zoomed so it never lingers on a stale tile after a channel swap.
const ZOOM_RESET_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
let zoomBadge: HTMLButtonElement | null = null;

function ensureZoomBadge(): HTMLButtonElement {
    if (zoomBadge) return zoomBadge;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zoom-badge";
    btn.setAttribute("aria-label", t("player.zoom.reset"));
    btn.title = t("player.zoom.reset");
    const scale = document.createElement("span");
    scale.className = "zoom-badge__scale mono";
    const icon = document.createElement("span");
    icon.className = "zoom-badge__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ZOOM_RESET_SVG;
    btn.append(scale, icon);
    // stopPropagation so the tap is not also read by the grid as an audio swap /
    // play-pause toggle.
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        resetVideoZoom();
    });
    zoomBadge = btn;
    return btn;
}

/** Shows/updates the zoom badge on the active tile while zoomed; removes it
 *  otherwise. Re-localizes the label each call so a langchange is picked up. */
function syncZoomBadge(): void {
    const z = state.videoZoom;
    const show = !state.exportModeOpen && z.scale > 1 && isFocusLayout(state.composition.layout) && !!state.active;
    if (!show) {
        zoomBadge?.remove();
        return;
    }
    const badge = ensureZoomBadge();
    badge.setAttribute("aria-label", t("player.zoom.reset"));
    badge.title = t("player.zoom.reset");
    const tile = activePlayer().parentElement;
    if (tile && badge.parentElement !== tile) tile.appendChild(badge);
    const scaleEl = badge.querySelector<HTMLElement>(".zoom-badge__scale");
    // Multiplier symbol - numeric, not a translatable string. Round to 1 decimal,
    // trailing .0 dropped by Number formatting ("2.4x", "3x").
    if (scaleEl) scaleEl.textContent = `${Math.round(z.scale * 10) / 10}x`;
}

/**
 * True if a pan drag just ended and consumed the click. The video click
 * handler in player.ts calls this first; if it returns true the click is
 * ignored. Single read also clears the flag (one click suppression per drag).
 */
export function consumeDragClickSuppress(): boolean {
    if (!wasDragging) return false;
    wasDragging = false;
    if (pinchClickSuppressTimer) {
        clearTimeout(pinchClickSuppressTimer);
        pinchClickSuppressTimer = 0;
    }
    return true;
}

/**
 * Syncs the mini-preview: visibility, src, aspect-ratio, viewport frame.
 * Called from applyVideoZoom (any zoom change) and from play/pause/seeked/
 * loadedmetadata listeners on the active <video>.
 */
function syncMinimap(): void {
    const z = state.videoZoom;
    const minimap = dom.videoMinimap;
    const mv = dom.videoMinimapVideo;
    const frame = dom.videoMinimapFrame;

    if (z.scale <= 1 || !isFocusLayout(state.composition.layout) || !state.active) {
        minimap.hidden = true;
        return;
    }
    const geom = computeZoomGeometry();
    if (!geom) {
        minimap.hidden = true;
        return;
    }
    const master = activePlayer();
    const masterFile = videoAttachedFile.get(master);
    if (!masterFile) {
        // Codec overlay is active or no file is attached - nothing to show.
        minimap.hidden = true;
        return;
    }
    // Master via MSE (hev1 remux or MPEG-TS): master blob URL is from
    // MediaSource, and MSE forbids attaching one MS to two media elements.
    // Native createObjectURL(file) wouldn't decode either (hev1 -> black; .ts
    // -> not supported). Hide mini-map.
    const cand = activeCandidate();
    if (cand && requiresMseBackend(cand)) {
        minimap.hidden = true;
        return;
    }
    minimap.hidden = false;
    minimap.style.aspectRatio = `${geom.vW} / ${geom.vH}`;

    // Mini-map plays the same file as master with its own blob URL + decoder.
    // Revoking the master URL doesn't break the mini-map - it has its own blob URL.
    if (mv.srcObject) mv.srcObject = null;
    const beforeFile = videoAttachedFile.get(mv);
    setVideoSrcFromFile(mv, masterFile);
    if (
        beforeFile === masterFile &&
        mv.readyState >= 2 &&
        Math.abs(mv.currentTime - master.currentTime) > SLAVE_DRIFT_MAX_SEC
    ) {
        // Same file, src unchanged - apply a drift fix if needed. If the file
        // changed, currentTime is applied in the loadedmetadata listener
        // installed below.
        mv.currentTime = master.currentTime;
    }
    if (master.paused !== mv.paused) {
        if (master.paused) mv.pause();
        else mv.play().catch(() => {});
    }
    mv.playbackRate = master.playbackRate;

    // Yellow viewport frame: map coordinates from displayed-frame space to
    // minimap.
    const miniW = minimap.clientWidth;
    if (miniW <= 0) return;
    const k = miniW / geom.dispW;
    const vpLeftFrame = -z.offsetX / z.scale - geom.padX;
    const vpTopFrame = -z.offsetY / z.scale - geom.padY;
    const vpWFrame = geom.tileW / z.scale;
    const vpHFrame = geom.tileH / z.scale;
    frame.style.left = `${vpLeftFrame * k}px`;
    frame.style.top = `${vpTopFrame * k}px`;
    frame.style.width = `${vpWFrame * k}px`;
    frame.style.height = `${vpHFrame * k}px`;
}

/**
 * Wheel zoom around the cursor. Updates state.videoZoom + applyVideoZoom.
 * Always calls preventDefault (including ctrlKey to block browser page-zoom).
 * The touch equivalent is the two-finger pinch (startPinch/updatePinch below).
 */
function handleVideoWheel(e: WheelEvent): void {
    if (state.exportModeOpen) return; // zoom suspended in export mode (crop owns the transform)
    if (!isFocusLayout(state.composition.layout)) return;
    if (!state.active) return;
    const target = e.target;
    if (!(target instanceof HTMLVideoElement)) return;
    if (target !== activePlayer()) return;
    // Stacked layout: the page scrolls past the player, and the video must
    // not trap that scroll - plain wheel falls through, zoom moves to
    // Ctrl/Cmd+wheel (a trackpad pinch arrives as a ctrlKey wheel, so the
    // pinch gesture keeps zooming). Mirrors the map's cooperative gestures;
    // the map's overlay hint teaches the modifier for both surfaces.
    if (isMobileLayout() && !e.ctrlKey && !e.metaKey) return;
    const geom = computeZoomGeometry();
    if (!geom) return;

    e.preventDefault();
    const z = state.videoZoom;
    const delta = -Math.sign(e.deltaY); // up = zoom in
    if (delta === 0) return;
    const factor = delta > 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
    const newScale = clamp(z.scale * factor, ZOOM_MIN, ZOOM_MAX);
    if (newScale === z.scale) return;

    // Anchor in UNTRANSFORMED video-element coordinates. Use the tile rect,
    // not the video rect: after the transform the video is already shifted by
    // the offset so its getBoundingClientRect is "moved" - cx would drift on
    // every wheel tick. The tile is never transformed; its rect matches the
    // pre-transform video. With transform-origin=0 0, pin the cursor point:
    //   cursor = (cursor - oldOffset) * (new/old).
    const rect = geom.tile.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ratio = newScale / z.scale;
    let nx = cx - (cx - z.offsetX) * ratio;
    let ny = cy - (cy - z.offsetY) * ratio;
    const c = clampZoomOffset(geom, newScale, nx, ny);
    nx = c.x;
    ny = c.y;
    state.videoZoom = { scale: newScale, offsetX: nx, offsetY: ny };
    applyVideoZoom();
}

/**
 * Pointer-down on the active video: single finger pans (only when zoomed in),
 * a second finger promotes the gesture to a pinch. We TRACK every contact on the
 * active video (even at 1x) so the second finger can start a pinch from rest -
 * the wheel path's only touch counterpart.
 */
function handleMainPointerDown(e: PointerEvent): void {
    if (state.exportModeOpen) return; // zoom suspended in export mode (crop owns the transform)
    if (!isFocusLayout(state.composition.layout)) return;
    if (!state.active) return;
    const target = e.target;
    if (!(target instanceof HTMLVideoElement)) return;
    if (target !== activePlayer()) return;
    if (e.button !== 0) return;

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2) {
        startPinch();
        return;
    }

    if (state.videoZoom.scale === 1) return; // nothing to pan at 1x; await a second finger
    const tile = target.parentElement;
    if (!tile) return;
    try {
        target.setPointerCapture(e.pointerId);
    } catch {
        /* capture may fail if pointer already inactive - continue without it */
    }
    mainDrag = {
        pointerId: e.pointerId,
        target,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffsetX: state.videoZoom.offsetX,
        startOffsetY: state.videoZoom.offsetY,
        maxDist: 0,
    };
    tile.classList.add("dragging");
}

/**
 * Begins a two-finger pinch on the active video. Supersedes any single-finger
 * pan, captures both pointers to the grid (so moves keep arriving if a finger
 * slides off the video), and snapshots the gesture start. updatePinch then keeps
 * the content point under the start centroid pinned to the moving centroid at the
 * new scale - zoom and pan in one gesture, reusing the wheel/pan clamp math.
 */
function startPinch(): void {
    if (mainDrag) {
        try {
            mainDrag.target.releasePointerCapture(mainDrag.pointerId);
        } catch {
            /* see above */
        }
        mainDrag.target.parentElement?.classList.remove("dragging");
        mainDrag = null;
    }
    const geom = computeZoomGeometry();
    if (!geom) return;
    const pts = [...activePointers.values()];
    const p1 = pts[0];
    const p2 = pts[1];
    if (!p1 || !p2) return;
    for (const id of activePointers.keys()) {
        try {
            dom.videoGrid.setPointerCapture(id);
        } catch {
            /* see above */
        }
    }
    const rect = geom.tile.getBoundingClientRect();
    pinch = {
        startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
        startScale: state.videoZoom.scale,
        startOffsetX: state.videoZoom.offsetX,
        startOffsetY: state.videoZoom.offsetY,
        startCentroidX: (p1.x + p2.x) / 2 - rect.left,
        startCentroidY: (p1.y + p2.y) / 2 - rect.top,
    };
}

function updatePinch(): void {
    if (!pinch) return;
    const geom = computeZoomGeometry();
    if (!geom) return;
    const pts = [...activePointers.values()];
    const p1 = pts[0];
    const p2 = pts[1];
    if (!p1 || !p2) return;
    const rect = geom.tile.getBoundingClientRect();
    const newDist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
    const newScale = clamp((pinch.startScale * newDist) / pinch.startDist, ZOOM_MIN, ZOOM_MAX);
    // Current centroid in tile coords.
    const cx = (p1.x + p2.x) / 2 - rect.left;
    const cy = (p1.y + p2.y) / 2 - rect.top;
    // The content point (untransformed video coords) under the start centroid
    // stays under the moving centroid at the new scale - same anchor logic as the
    // wheel path, but the centroid also translates, so the gesture pans too.
    const contentX = (pinch.startCentroidX - pinch.startOffsetX) / pinch.startScale;
    const contentY = (pinch.startCentroidY - pinch.startOffsetY) / pinch.startScale;
    const c = clampZoomOffset(geom, newScale, cx - contentX * newScale, cy - contentY * newScale);
    state.videoZoom = { scale: newScale, offsetX: c.x, offsetY: c.y };
    applyVideoZoom();
}

/** Ends the pinch once fewer than two fingers remain on the active video. */
function endPinch(): void {
    pinch = null;
    // Suppress a click the lifting finger might synthesize (so it isn't read as
    // play/pause or an audio swap). Self-clearing: a multi-touch gesture usually
    // fires no click at all, and the persistent flag must not eat the next tap.
    wasDragging = true;
    if (pinchClickSuppressTimer) clearTimeout(pinchClickSuppressTimer);
    pinchClickSuppressTimer = window.setTimeout(() => {
        wasDragging = false;
        pinchClickSuppressTimer = 0;
    }, 400);
}

function handleMainPointerMove(e: PointerEvent): void {
    if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch) {
        updatePinch();
        return;
    }
    if (!mainDrag) return;
    if (e.pointerId !== mainDrag.pointerId) return;
    const dx = e.clientX - mainDrag.startClientX;
    const dy = e.clientY - mainDrag.startClientY;
    const dist = Math.hypot(dx, dy);
    if (dist > mainDrag.maxDist) mainDrag.maxDist = dist;
    const geom = computeZoomGeometry();
    if (!geom) return;
    const z = state.videoZoom;
    const c = clampZoomOffset(geom, z.scale, mainDrag.startOffsetX + dx, mainDrag.startOffsetY + dy);
    state.videoZoom = { scale: z.scale, offsetX: c.x, offsetY: c.y };
    applyVideoZoom();
}

function handleMainPointerUp(e: PointerEvent): void {
    // A pinch-tracked contact lifts: drop it and, if it was part of a pinch, tear
    // the pinch down once under two fingers. A single-finger pan pointer is also
    // tracked here, but pinch is null for it, so it falls through to pan teardown.
    if (activePointers.delete(e.pointerId)) {
        if (pinch) {
            try {
                dom.videoGrid.releasePointerCapture(e.pointerId);
            } catch {
                /* see above */
            }
            if (activePointers.size < 2) endPinch();
            return;
        }
    }
    if (!mainDrag) return;
    if (e.pointerId !== mainDrag.pointerId) return;
    const target = mainDrag.target;
    const tile = target.parentElement;
    try {
        target.releasePointerCapture(mainDrag.pointerId);
    } catch {
        /* see above */
    }
    tile?.classList.remove("dragging");
    // If there was a real drag (>= threshold), suppress the subsequent click
    // so pointerup-after-drag doesn't toggle play/pause.
    wasDragging = mainDrag.maxDist >= DRAG_PIXEL_THRESHOLD;
    mainDrag = null;
}

/**
 * Pan via mini-preview: cursor position in minimap becomes the new center of
 * the main tile viewport. Click without move = jump; drag with move =
 * continuous pan.
 */
function handleMinimapPointerDown(e: PointerEvent): void {
    if (state.videoZoom.scale === 1) return;
    if (e.button !== 0) return;
    const minimap = dom.videoMinimap;
    try {
        minimap.setPointerCapture(e.pointerId);
    } catch {
        /* see above */
    }
    minimapDrag = { pointerId: e.pointerId };
    panFromMinimapToCursor(e);
}

function handleMinimapPointerMove(e: PointerEvent): void {
    if (!minimapDrag) return;
    if (e.pointerId !== minimapDrag.pointerId) return;
    panFromMinimapToCursor(e);
}

function handleMinimapPointerUp(e: PointerEvent): void {
    if (!minimapDrag) return;
    if (e.pointerId !== minimapDrag.pointerId) return;
    try {
        dom.videoMinimap.releasePointerCapture(minimapDrag.pointerId);
    } catch {
        /* see above */
    }
    minimapDrag = null;
}

function panFromMinimapToCursor(e: PointerEvent): void {
    const geom = computeZoomGeometry();
    if (!geom) return;
    const minimap = dom.videoMinimap;
    const rect = minimap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const k = rect.width / geom.dispW;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const fxFrame = mx / k; // position in the main tile's displayed-rect
    const fyFrame = my / k;
    const z = state.videoZoom;
    // We want (fxFrame, fyFrame) in displayed-frame space to land at the tile
    // center. Displayed-frame is offset by padX,padY relative to tile rect.
    let nx = geom.tileW / 2 - (fxFrame + geom.padX) * z.scale;
    let ny = geom.tileH / 2 - (fyFrame + geom.padY) * z.scale;
    const c = clampZoomOffset(geom, z.scale, nx, ny);
    nx = c.x;
    ny = c.y;
    state.videoZoom = { scale: z.scale, offsetX: nx, offsetY: ny };
    applyVideoZoom();
}

/**
 * Clamps state.videoZoom to current geometry and re-applies the transform.
 * Called from the loadedmetadata listener in player.ts after a src change
 * within the same trip (aspect/frame size may differ slightly between files).
 */
export function reclampAndApplyZoom(): void {
    if (state.videoZoom.scale <= 1) return;
    const geom = computeZoomGeometry();
    if (geom) {
        const c = clampZoomOffset(geom, state.videoZoom.scale, state.videoZoom.offsetX, state.videoZoom.offsetY);
        state.videoZoom = { scale: state.videoZoom.scale, offsetX: c.x, offsetY: c.y };
    }
    applyVideoZoom();
}

/**
 * Wires up all zoom + minimap listeners on the player. Call once during
 * initPlayer.
 */
export function initPlayerZoom(): void {
    // Wheel attached to .video-grid, filtered by target=activePlayer().
    // passive:false because preventDefault blocks browser page-zoom
    // (Ctrl+Wheel) and page scroll.
    dom.videoGrid.addEventListener("wheel", handleVideoWheel, { passive: false });
    dom.videoGrid.addEventListener("pointerdown", handleMainPointerDown);
    dom.videoGrid.addEventListener("pointermove", handleMainPointerMove);
    dom.videoGrid.addEventListener("pointerup", handleMainPointerUp);
    dom.videoGrid.addEventListener("pointercancel", handleMainPointerUp);

    dom.videoMinimap.addEventListener("pointerdown", handleMinimapPointerDown);
    dom.videoMinimap.addEventListener("pointermove", handleMinimapPointerMove);
    dom.videoMinimap.addEventListener("pointerup", handleMinimapPointerUp);
    dom.videoMinimap.addEventListener("pointercancel", handleMinimapPointerUp);

    // Mirror master playback state into the duplicate video. Channel swap
    // automatically redirects via onActivePlayerEvent.
    onActivePlayerEvent("play", () => {
        if (state.videoZoom.scale > 1 && !dom.videoMinimap.hidden) {
            dom.videoMinimapVideo.play().catch(() => {});
        }
    });
    onActivePlayerEvent("pause", () => {
        dom.videoMinimapVideo.pause();
    });
    onActivePlayerEvent("seeked", () => {
        if (state.videoZoom.scale > 1) {
            const master = activePlayer();
            if (dom.videoMinimapVideo.readyState >= 1) {
                dom.videoMinimapVideo.currentTime = master.currentTime;
            }
        }
    });
    dom.videoMinimapVideo.addEventListener("loadedmetadata", () => {
        const master = activePlayer();
        dom.videoMinimapVideo.currentTime = master.currentTime;
        dom.videoMinimapVideo.playbackRate = master.playbackRate;
        if (!master.paused && state.videoZoom.scale > 1) {
            dom.videoMinimapVideo.play().catch(() => {});
        }
    });

    // Tile resize -> clamp offsets to new geometry. ResizeObserver on the
    // grid catches sidebar drag-resize, chart resize, fullscreen enter/exit.
    if (typeof ResizeObserver === "function") {
        const ro = new ResizeObserver(() => {
            reclampAndApplyZoom();
        });
        ro.observe(dom.videoGrid);
    }
}

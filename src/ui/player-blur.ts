// Blur-region editing + live preview in export-mode.
//
// The export panel's "Add blur zone" button arms draw mode: the user drags a
// rectangle on a video tile (tap on touch plants a default-sized box) and a
// region is created at the playhead with a default forward span. Regions active
// at the current playhead render as draggable boxes (corner handles) over their
// channel's tile; moving/resizing a box writes a PINNED keyframe at the playhead
// (src/blur-regions.ts) - the FCP/CapCut pattern where an adjustment silently
// becomes a keyframe. The redaction itself is previewed on a per-tile canvas,
// painted with the SAME compose helpers the export burn-in uses (paintRegionBlur
// + mapRegionRectToDest), so preview == output by construction.
//
// Geometry: regions store rects in normalized source coords. In export-mode a
// tile shows either the full source frame (contain-fit) or, with a crop set,
// the crop result (player-crop owns video.style.transform/clip-path) - both
// reduce to "source view rect fitted into a dest rect", which is exactly the
// mapping mapRegionRectToDest implements. While a tile is in crop-editing the
// blur UI on it is hidden (the crop editor's drag view breaks the mapping and
// owning the same surface would fight over pointer events).
//
// Redraw: one rAF loop, gated on export-mode + regions present. rVFC per video
// would be cheaper while paused, but the preload-slot swap (dom.ts) makes
// per-element callback registration churn-prone; the loop reads the live
// channelPlayers proxy every tick instead and skips repaint work when neither
// time nor geometry changed. No logging here - hot path.

import { t } from "../i18n/index.js";
import type { Channel } from "../parsers/types.js";
import {
    createBlurRegion,
    DEFAULT_ZONE_SPAN_SEC,
    MIN_ZONE_SPAN_SEC,
    regionRectAt,
    upsertKeyframe,
    ZONE_START_PLAYHEAD_BACKOFF_SEC,
    type BlurRegion,
} from "../blur-regions.js";
import type { CropRect } from "../transcode/compose.js";
import {
    createRegionBlurHelper,
    mapRegionRectToDest,
    paintRegionBlur,
    snapRegionToMosaicGrid,
    type RegionBlurHelper,
} from "../transcode/compose.js";

import {
    activeBlurRegions,
    addBlurRegion,
    notifyBlurRegionsChanged,
    subscribeBlurRegions,
} from "./blur-regions-state.js";
import { activeEffectiveBlurRegions } from "./blur-effective.js";
import { detectRegions, subscribeBlurDetect } from "./blur-detect.js";
import { ALL_CHANNELS, channelPlayers, channelTileFor, dom } from "./dom.js";
import { exportPanelState, notifyExportStateChanged, subscribeExportState } from "./export-state.js";
import { channelDisplayLabel } from "./format.js";
import { exitCropEditIfOpen } from "./player-crop.js";
import { attachPointerDrag } from "./pointer-drag.js";
import { getTripCurrentTime } from "./player.js";
import { activeTrip, state } from "./state.js";
import { cancelTrackPassesExceptTrip } from "./blur-track.js";
import { containRect, type Rect } from "./video-geometry.js";

/** Smallest region dimension as a fraction of the source frame. */
const MIN_REGION = 0.01;
/** Default box size (fraction of the source min dimension) for a tap-plant. */
const TAP_BOX_FRAC = 0.15;
/** Drag shorter than this (px) counts as a tap -> default-sized box. */
const TAP_DRAG_PX = 12;

interface TileUi {
    /** Preview canvas painting the redaction patches. */
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    /** Region boxes layer (outlines + handles). */
    boxLayer: HTMLDivElement;
    /** region id -> box element, rebuilt on region list changes. */
    boxes: Map<string, HTMLDivElement>;
    /** Last painted state, to skip idle repaints. */
    lastSig: string;
}

const tileUis = new Map<Channel, TileUi>();
let previewHelper: RegionBlurHelper | null = null;
let rafId = 0;
let armed = false;
let drawLayerEls: HTMLDivElement[] = [];
// Bumped by anything that changes geometry (resize, crop, layout) so the rAF
// loop repaints even at an unchanged playhead.
let geometryEpoch = 0;

let lastSeenTrip: ReturnType<typeof activeTrip> = null;

export function initPlayerBlur(): void {
    subscribeExportState(() => {
        if (!blurEditorActive()) disarmDraw();
        // Trip switch invalidates the armed draw layers (their channel
        // closures and tile bindings belong to the previous trip).
        const trip = activeTrip();
        if (trip !== lastSeenTrip) {
            lastSeenTrip = trip;
            disarmDraw();
            cancelTrackPassesExceptTrip(state.exportModeOpen ? trip : null);
        } else if (!state.exportModeOpen) {
            cancelTrackPassesExceptTrip(null);
        }
        geometryEpoch++;
        syncLifecycle();
    });
    subscribeBlurRegions(() => {
        geometryEpoch++;
        syncLifecycle();
    });
    // Auto-detected regions arrive/expire without touching the manual list -
    // repaint (and start/stop the loop) on their changes too.
    subscribeBlurDetect(() => {
        geometryEpoch++;
        syncLifecycle();
    });
    // Escape cancels draw-arming before anything else (capture phase, same
    // pattern as the crop editor's Escape).
    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape" && armed) {
                e.preventDefault();
                e.stopPropagation();
                disarmDraw();
            }
        },
        { capture: true },
    );
    if (typeof ResizeObserver !== "undefined" && dom.videoGrid) {
        const ro = new ResizeObserver(() => {
            geometryEpoch++;
        });
        ro.observe(dom.videoGrid);
    }
}

// --- lifecycle -------------------------------------------------------------

function blurUiActive(): boolean {
    // Auto-detected regions paint too (no editor boxes for them - see tick),
    // so a trip with only checkbox-found blur still gets a live preview.
    return state.exportModeOpen && (activeBlurRegions().length > 0 || detectRegions().length > 0);
}

/** Editing is allowed only while configuring. The preview remains visible in
 *  progress so the frame still matches the immutable export snapshot, but its
 *  boxes must not imply that late edits can affect that run. */
function blurEditorActive(): boolean {
    return state.exportModeOpen && exportPanelState.phase === "options" && !exportPanelState.configurationLocked;
}

/** Creates/destroys per-tile UI and starts/stops the rAF loop to match state. */
function syncLifecycle(): void {
    const active = blurUiActive();
    if (active) {
        for (const ch of ALL_CHANNELS) {
            if (state.composition.channelOrder.indexOf(ch) >= 0) ensureTileUi(ch);
        }
        // Drop UI for channels that left the layout.
        for (const [ch, ui] of tileUis) {
            if (state.composition.channelOrder.indexOf(ch) < 0) {
                destroyTileUi(ui);
                tileUis.delete(ch);
            }
        }
        rebuildBoxes();
        if (!rafId) rafId = requestAnimationFrame(tick);
    } else {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        for (const ui of tileUis.values()) destroyTileUi(ui);
        tileUis.clear();
    }
}

function ensureTileUi(ch: Channel): TileUi {
    let ui = tileUis.get(ch);
    if (ui) return ui;
    const tile = channelTileFor(ch);
    const canvas = document.createElement("canvas");
    canvas.className = "blur-preview-canvas";
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("blur preview canvas ctx unavailable");
    const boxLayer = document.createElement("div");
    boxLayer.className = "blur-box-layer";
    tile.appendChild(canvas);
    tile.appendChild(boxLayer);
    ui = { canvas, ctx, boxLayer, boxes: new Map(), lastSig: "" };
    tileUis.set(ch, ui);
    return ui;
}

function destroyTileUi(ui: TileUi): void {
    ui.canvas.remove();
    ui.boxLayer.remove();
}

// --- geometry ---------------------------------------------------------------

/** Source view (crop or full frame) in video px + the tile rect it maps onto.
 *  Mirrors the export mapping: view = crop window, dest = keep-aspect fit of
 *  the view in the tile (see player-crop's resultContentRect). Null when the
 *  video has no dimensions yet. */
function tileMapping(ch: Channel): { vw: number; vh: number; view: CropRect; dest: Rect } | null {
    const v = channelPlayers[ch];
    const tile = channelTileFor(ch);
    if (!v || v.videoWidth <= 0 || v.videoHeight <= 0 || tile.clientWidth <= 0) return null;
    const slotIdx = state.composition.channelOrder.indexOf(ch);
    const crop = (slotIdx >= 0 ? state.composition.perSlotCrops[slotIdx] : null) ?? {
        xPct: 0,
        yPct: 0,
        wPct: 1,
        hPct: 1,
    };
    const viewAspect = (v.videoWidth / v.videoHeight) * (crop.wPct / Math.max(1e-6, crop.hPct));
    const dest = containRect(viewAspect, tile.clientWidth, tile.clientHeight);
    return { vw: v.videoWidth, vh: v.videoHeight, view: crop, dest };
}

/** Region rect (normalized source) -> tile px, honoring the crop view. */
function regionRectToTile(ch: Channel, rect: CropRect): { x: number; y: number; w: number; h: number } | null {
    const m = tileMapping(ch);
    if (!m) return null;
    return mapRegionRectToDest(
        rect,
        m.vw,
        m.vh,
        m.view.xPct * m.vw,
        m.view.yPct * m.vh,
        m.view.wPct * m.vw,
        m.view.hPct * m.vh,
        m.dest.x,
        m.dest.y,
        m.dest.w,
        m.dest.h,
    );
}

/** Tile px point -> normalized source coords (clamped to the visible view). */
function tilePointToSource(ch: Channel, px: number, py: number): { x: number; y: number } | null {
    const m = tileMapping(ch);
    if (!m) return null;
    const fx = Math.max(0, Math.min(1, (px - m.dest.x) / m.dest.w));
    const fy = Math.max(0, Math.min(1, (py - m.dest.y) / m.dest.h));
    return { x: m.view.xPct + fx * m.view.wPct, y: m.view.yPct + fy * m.view.hPct };
}

// --- preview loop ------------------------------------------------------------

function tick(): void {
    rafId = 0;
    if (!blurUiActive()) return;
    const contentSec = getTripCurrentTime();
    // Manual zones + auto-detected regions paint identically; only manual ones
    // get editor boxes (rebuildBoxes reads activeBlurRegions alone - dozens of
    // non-editable auto boxes would bury the drag handles).
    const regions = activeEffectiveBlurRegions();
    for (const [ch, ui] of tileUis) {
        paintTile(ch, ui, regions, contentSec);
    }
    rafId = requestAnimationFrame(tick);
}

function paintTile(ch: Channel, ui: TileUi, regions: readonly BlurRegion[], contentSec: number): void {
    const tile = channelTileFor(ch);
    // The crop editor owns this tile's surface and transform right now.
    const cropEditing = tile.classList.contains("crop-editing");
    const v = channelPlayers[ch];
    // Repaint only when something could have changed: time moved, geometry
    // epoch bumped, or the region list was edited (epoch covers that too).
    const sig = `${cropEditing ? "c" : ""}|${v?.currentTime ?? -1}|${geometryEpoch}|${tile.clientWidth}x${tile.clientHeight}`;
    if (sig === ui.lastSig) return;
    ui.lastSig = sig;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(tile.clientWidth * dpr));
    const h = Math.max(1, Math.round(tile.clientHeight * dpr));
    if (ui.canvas.width !== w || ui.canvas.height !== h) {
        ui.canvas.width = w;
        ui.canvas.height = h;
    }
    const ctx = ui.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tile.clientWidth, tile.clientHeight);
    ui.boxLayer.hidden = cropEditing || !blurEditorActive();
    if (cropEditing || !v || tile.hidden) return;

    previewHelper ??= createRegionBlurHelper();
    for (const region of regions) {
        if (region.channel !== ch) continue;
        const rect = regionRectAt(region, contentSec);
        const box = ui.boxes.get(region.id);
        if (!rect) {
            if (box) box.hidden = true;
            continue;
        }
        const tileRect = regionRectToTile(ch, rect);
        if (!tileRect) {
            if (box) box.hidden = true;
            continue;
        }
        // Patch pixels straight from the <video> (blob:/MSE sources are
        // same-origin, no taint). Source rect in video px. Pixelate snaps to
        // the scene-anchored grid - the same snap the burn-in applies - so the
        // preview shows the exact block layout of the output.
        let patchRect = rect;
        let grid: { cols: number; rows: number } | undefined;
        if (region.style === "pixelate") {
            const m = tileMapping(ch);
            const snapped = m
                ? snapRegionToMosaicGrid(
                      rect,
                      v.videoWidth,
                      v.videoHeight,
                      m.view.xPct * v.videoWidth,
                      m.view.yPct * v.videoHeight,
                      m.view.wPct * v.videoWidth,
                      m.view.hPct * v.videoHeight,
                  )
                : null;
            if (!snapped) {
                if (box) box.hidden = true;
                continue;
            }
            patchRect = snapped.rect;
            grid = { cols: snapped.cols, rows: snapped.rows };
        }
        const patchTileRect = patchRect === rect ? tileRect : regionRectToTile(ch, patchRect);
        if (patchTileRect) {
            paintRegionBlur(
                ctx,
                v,
                {
                    x: patchRect.xPct * v.videoWidth,
                    y: patchRect.yPct * v.videoHeight,
                    w: patchRect.wPct * v.videoWidth,
                    h: patchRect.hPct * v.videoHeight,
                },
                patchTileRect,
                region.style,
                previewHelper,
                grid,
            );
        }
        if (box) {
            box.hidden = false;
            box.style.left = `${tileRect.x}px`;
            box.style.top = `${tileRect.y}px`;
            box.style.width = `${tileRect.w}px`;
            box.style.height = `${tileRect.h}px`;
        }
    }
}

// --- region boxes (drag = pinned keyframe) -----------------------------------

function rebuildBoxes(): void {
    if (!blurUiActive()) return;
    const byChannel = new Map<Channel, { entries: Array<{ region: BlurRegion; index: number }>; ids: Set<string> }>();
    for (const [index, region] of activeBlurRegions().entries()) {
        let group = byChannel.get(region.channel);
        if (!group) {
            group = { entries: [], ids: new Set() };
            byChannel.set(region.channel, group);
        }
        group.entries.push({ region, index });
        group.ids.add(region.id);
    }
    for (const [ch, ui] of tileUis) {
        const group = byChannel.get(ch);
        for (const [id, el] of ui.boxes) {
            if (!group?.ids.has(id)) {
                el.remove();
                ui.boxes.delete(id);
            }
        }
        if (!group) continue;
        for (const { region, index } of group.entries) {
            const existing = ui.boxes.get(region.id);
            if (existing) {
                existing.setAttribute("aria-label", regionBoxAriaLabel(region, index));
                continue;
            }
            const el = buildRegionBox(region, index);
            ui.boxLayer.appendChild(el);
            ui.boxes.set(region.id, el);
        }
    }
}

function regionBoxAriaLabel(region: BlurRegion, index: number): string {
    const zoneName = t("export.blur.zone", { n: index + 1 });
    const trip = activeTrip();
    const channelName = trip ? ` · ${channelDisplayLabel(region.channel, trip)}` : "";
    return `${zoneName}${channelName}. ${t("export.blur.editBox")}`;
}

function buildRegionBox(region: BlurRegion, index: number): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "blur-box";
    el.hidden = true;
    el.tabIndex = 0;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", regionBoxAriaLabel(region, index));
    el.addEventListener("keydown", (event) => editBoxWithKeyboard(region, event));
    for (const corner of ["tl", "tr", "bl", "br"] as const) {
        const hnd = document.createElement("div");
        hnd.className = `blur-box-handle blur-box-handle--${corner}`;
        el.appendChild(hnd);
        attachBoxHandleDrag(region, hnd, corner);
    }
    attachBoxMoveDrag(region, el);
    return el;
}

/** Keyboard equivalent of dragging the visual box. Arrows move it; Shift+arrows
 *  resize its right/bottom edges. */
function editBoxWithKeyboard(region: BlurRegion, event: KeyboardEvent): void {
    if (!blurEditorActive() || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const current = regionRectAt(region, getTripCurrentTime());
    if (!current) return;
    const step = 0.005;
    const next = { ...current };
    if (event.shiftKey) {
        if (event.key === "ArrowLeft") next.wPct = Math.max(MIN_REGION, next.wPct - step);
        if (event.key === "ArrowRight") next.wPct = Math.min(1 - next.xPct, next.wPct + step);
        if (event.key === "ArrowUp") next.hPct = Math.max(MIN_REGION, next.hPct - step);
        if (event.key === "ArrowDown") next.hPct = Math.min(1 - next.yPct, next.hPct + step);
    } else {
        if (event.key === "ArrowLeft") next.xPct = Math.max(0, next.xPct - step);
        if (event.key === "ArrowRight") next.xPct = Math.min(1 - next.wPct, next.xPct + step);
        if (event.key === "ArrowUp") next.yPct = Math.max(0, next.yPct - step);
        if (event.key === "ArrowDown") next.yPct = Math.min(1 - next.hPct, next.yPct + step);
    }
    event.preventDefault();
    event.stopPropagation();
    if (dom.player && !dom.player.paused) dom.player.pause();
    commitRect(region, next);
}

/** Commits the box's current rect as a pinned keyframe at the playhead. */
function commitRect(region: BlurRegion, rect: CropRect): void {
    // Save can lock the form while a keyboard/pointer gesture is already in
    // flight. The export has its own snapshot; stop the editor too so a late
    // pointerup does not create a zone that appears to belong to that run.
    if (!blurEditorActive()) return;
    upsertKeyframe(region, getTripCurrentTime(), rect, true);
    geometryEpoch++;
    notifyBlurRegionsChanged();
}

function attachBoxMoveDrag(region: BlurRegion, el: HTMLDivElement): void {
    let startX = 0;
    let startY = 0;
    let base: CropRect | null = null;
    // The synthetic click after a drag would bubble to the tile and trigger
    // its click behavior (audio-channel swap on non-master tiles).
    el.addEventListener("click", (e) => e.stopPropagation());
    attachPointerDrag(el, {
        onStart: (e) => {
            if (!blurEditorActive()) return false;
            if ((e.target as HTMLElement)?.classList.contains("blur-box-handle")) return false;
            // Editing a box on moving video is chaos - hold the frame.
            if (dom.player && !dom.player.paused) dom.player.pause();
            base = regionRectAt(region, getTripCurrentTime());
            if (!base) return false;
            startX = e.clientX;
            startY = e.clientY;
            e.preventDefault();
            e.stopPropagation();
            return true;
        },
        onMove: (e) => {
            if (!base) return;
            // Space/K can resume playback mid-drag; a moving playhead would
            // smear a keyframe trail. Hold the frame for the whole gesture.
            if (dom.player && !dom.player.paused) dom.player.pause();
            const m = tileMapping(region.channel);
            if (!m || m.dest.w <= 0) return;
            // Pointer delta in tile px -> normalized source delta through the view.
            const dx = ((e.clientX - startX) / m.dest.w) * m.view.wPct;
            const dy = ((e.clientY - startY) / m.dest.h) * m.view.hPct;
            const xPct = Math.max(0, Math.min(1 - base.wPct, base.xPct + dx));
            const yPct = Math.max(0, Math.min(1 - base.hPct, base.yPct + dy));
            commitRect(region, { ...base, xPct, yPct });
        },
    });
}

function attachBoxHandleDrag(region: BlurRegion, handle: HTMLElement, corner: "tl" | "tr" | "bl" | "br"): void {
    let base: CropRect | null = null;
    attachPointerDrag(handle, {
        onStart: (e) => {
            if (!blurEditorActive()) return false;
            if (dom.player && !dom.player.paused) dom.player.pause();
            base = regionRectAt(region, getTripCurrentTime());
            if (!base) return false;
            e.preventDefault();
            e.stopPropagation();
            return true;
        },
        onMove: (e) => {
            if (!base) return;
            if (dom.player && !dom.player.paused) dom.player.pause();
            const ch = region.channel;
            const tile = channelTileFor(ch);
            const tileRect = tile.getBoundingClientRect();
            const p = tilePointToSource(ch, e.clientX - tileRect.left, e.clientY - tileRect.top);
            if (!p) return;
            let { xPct, yPct, wPct, hPct } = base;
            const right = xPct + wPct;
            const bottom = yPct + hPct;
            if (corner === "tl" || corner === "bl") {
                xPct = Math.min(p.x, right - MIN_REGION);
                wPct = right - xPct;
            } else {
                wPct = Math.max(MIN_REGION, p.x - xPct);
            }
            if (corner === "tl" || corner === "tr") {
                yPct = Math.min(p.y, bottom - MIN_REGION);
                hPct = bottom - yPct;
            } else {
                hPct = Math.max(MIN_REGION, p.y - yPct);
            }
            commitRect(region, { xPct, yPct, wPct, hPct });
        },
    });
}

// --- draw-arming (Add blur zone) ----------------------------------------------

/** True while the "draw a zone" mode is armed (the panel button toggles it). */
export function isBlurDrawArmed(): boolean {
    return armed;
}

/** Arms draw mode: a capture layer appears over every visible tile; the next
 *  drag (or tap) creates a region on that tile's channel. Escape or a second
 *  call disarms. No-op outside export-mode. */
export function toggleBlurDraw(): void {
    if (armed) {
        disarmDraw();
        return;
    }
    if (!blurEditorActive()) return;
    // The crop editor owns tile surfaces and the video transform - the two
    // editors must not share a tile. Close it before arming.
    exitCropEditIfOpen();
    armed = true;
    if (dom.player && !dom.player.paused) dom.player.pause();
    for (const ch of ALL_CHANNELS) {
        if (state.composition.channelOrder.indexOf(ch) < 0) continue;
        const tile = channelTileFor(ch);
        if (tile.hidden) continue;
        const layer = document.createElement("div");
        layer.className = "blur-draw-layer";
        const hint = document.createElement("div");
        hint.className = "blur-draw-hint";
        hint.textContent = t("export.blur.drawHint");
        layer.appendChild(hint);
        attachDrawDrag(ch, layer);
        tile.appendChild(layer);
        drawLayerEls.push(layer);
    }
    notifyExportStateChanged();
}

function disarmDraw(): void {
    if (!armed) return;
    armed = false;
    for (const el of drawLayerEls) el.remove();
    drawLayerEls = [];
    notifyExportStateChanged();
}

function attachDrawDrag(ch: Channel, layer: HTMLDivElement): void {
    let sx = 0;
    let sy = 0;
    let marquee: HTMLDivElement | null = null;
    // Post-drag synthetic click must not reach the tile (audio swap / pip).
    layer.addEventListener("click", (e) => e.stopPropagation());
    attachPointerDrag(layer, {
        onStart: (e) => {
            if (!blurEditorActive()) return false;
            sx = e.clientX;
            sy = e.clientY;
            marquee = document.createElement("div");
            marquee.className = "blur-box blur-box--marquee";
            layer.appendChild(marquee);
            e.preventDefault();
            // Without this the pointerdown bubbles to the tile, whose PiP
            // drag accepts it and steals the pointer capture - the inset
            // moves under the marquee and this layer's drag never finishes.
            e.stopPropagation();
            return true;
        },
        onMove: (e) => {
            if (!marquee) return;
            const r = layer.getBoundingClientRect();
            const x = Math.min(sx, e.clientX) - r.left;
            const y = Math.min(sy, e.clientY) - r.top;
            marquee.style.left = `${x}px`;
            marquee.style.top = `${y}px`;
            marquee.style.width = `${Math.abs(e.clientX - sx)}px`;
            marquee.style.height = `${Math.abs(e.clientY - sy)}px`;
            marquee.hidden = false;
        },
        onEnd: (e) => {
            marquee?.remove();
            marquee = null;
            finishDraw(ch, layer, sx, sy, e.clientX, e.clientY);
        },
    });
}

function finishDraw(ch: Channel, layer: HTMLDivElement, x0: number, y0: number, x1: number, y1: number): void {
    if (!blurEditorActive()) {
        disarmDraw();
        return;
    }
    const trip = activeTrip();
    if (!trip) {
        disarmDraw();
        return;
    }
    const layerRect = layer.getBoundingClientRect();
    const a = tilePointToSource(ch, Math.min(x0, x1) - layerRect.left, Math.min(y0, y1) - layerRect.top);
    const b = tilePointToSource(ch, Math.max(x0, x1) - layerRect.left, Math.max(y0, y1) - layerRect.top);
    if (!a || !b) {
        disarmDraw();
        return;
    }
    let rect: CropRect;
    if (Math.hypot(x1 - x0, y1 - y0) < TAP_DRAG_PX) {
        // Tap: plant a default-sized box centered on the point (the touch
        // affordance - precision drag-drawing with a finger is miserable).
        const m = tileMapping(ch);
        if (!m) {
            disarmDraw();
            return;
        }
        // Square in source PIXELS, sized off the frame height: hPct stays
        // TAP_BOX_FRAC, wPct compensates the aspect (clamped for extremes).
        const hPct = TAP_BOX_FRAC;
        const wPct = Math.min(1, TAP_BOX_FRAC * (m.vh / m.vw));
        rect = {
            xPct: Math.max(0, Math.min(1 - wPct, a.x - wPct / 2)),
            yPct: Math.max(0, Math.min(1 - hPct, a.y - hPct / 2)),
            wPct,
            hPct,
        };
    } else {
        rect = {
            xPct: a.x,
            yPct: a.y,
            wPct: Math.max(MIN_REGION, b.x - a.x),
            hPct: Math.max(MIN_REGION, b.y - a.y),
        };
    }
    const now = getTripCurrentTime();
    const dur = trip.timeline.contentDurationSec;
    // Start one frame BEFORE the playhead (the displayed frame's timestamp is
    // <= currentTime - see ZONE_START_PLAYHEAD_BACKOFF_SEC), and guarantee a
    // minimum span when the playhead sits at the trip end, where
    // [now, now+span] would collapse to zero exported frames.
    let startSec = Math.max(0, Math.min(now, dur) - ZONE_START_PLAYHEAD_BACKOFF_SEC);
    const endSec = Math.min(dur, Math.max(now + DEFAULT_ZONE_SPAN_SEC, startSec + MIN_ZONE_SPAN_SEC));
    if (endSec - startSec < MIN_ZONE_SPAN_SEC) startSec = Math.max(0, endSec - MIN_ZONE_SPAN_SEC);
    const region = createBlurRegion(ch, exportPanelState.blurStyle, startSec, endSec, Math.min(now, endSec), rect);
    // Order matters: the region must be in the store BEFORE disarmDraw's
    // export-state notify, or the quality-tier estimate recomputes without it
    // and keeps the stale "Original (stream copy)" label until the next edit.
    addBlurRegion(region);
    disarmDraw();
}

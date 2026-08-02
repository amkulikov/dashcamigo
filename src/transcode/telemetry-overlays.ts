// Telemetry-widget drawing for one frame - scrim + text readouts + dials +
// graph. Split from pipeline-common.ts on purpose: the player's live overlay
// preview (ui/player-overlays.ts, EAGER on the landing entry) calls
// drawTelemetryOverlays too, and pipeline-common carries value imports of
// mediabunny (muxer plumbing) that must stay out of the eager bundle. This
// module must not import mediabunny by value (types are fine); the guard is
// scripts/check-lazy-chunks.mjs.

import type { FramePos } from "./frame-pos.js";
import { drawCompass, drawGforce, drawGraph } from "./overlay-widgets.js";
import {
    drawCoordsBox,
    drawNoFixBox,
    drawWidgetBox,
    formatClock,
    formatDistanceValue,
    formatSpeedValue,
} from "./text-overlay.js";
import type { OverlayPipelineArgs } from "./types.js";

/**
 * Draws all enabled non-map telemetry widgets for one frame, in the run's
 * style. The map overlay is async (snapshotter round-trip) and stays in
 * consumeMapSnapshot; this covers scrim + text widgets + dials + graph.
 * Both pipelines call this, so the widget set and styling cannot drift between
 * single-channel and split-screen exports.
 *
 * Draw order: scrim first (a backdrop for legibility), then graph/dials, then
 * text readouts on top.
 */
export function drawTelemetryOverlays(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    widthPx: number,
    heightPx: number,
    overlays: OverlayPipelineArgs,
    pos: FramePos,
): void {
    const { style, accent, units } = overlays;

    if (overlays.scrim) drawScrim(ctx, widthPx, heightPx);

    if (overlays.graph && overlays.graphSamples) {
        drawGraph(
            ctx,
            widthPx,
            heightPx,
            overlays.graph,
            style,
            accent,
            pos,
            overlays.graphSamples,
            units,
            overlays.unitSpeed,
        );
    }
    if (overlays.compass) {
        drawCompass(ctx, widthPx, heightPx, overlays.compass, style, accent, pos, overlays.cardinals);
    }
    if (overlays.gforce) {
        drawGforce(ctx, widthPx, heightPx, overlays.gforce, style, accent, pos, overlays.brakeThresholdG);
    }

    // GPS-fed readouts swap to the no-fix placeholder (same plate, crossed-pin
    // icon) when the frame has no usable fix - receiver warm-up at clip start,
    // long dropouts. The clock stays live either way: it reads the timeline,
    // not the receiver. Each placeholder reuses its widget's valueScale so the
    // footprint stays familiar.
    if (overlays.speed) {
        if (pos.hasFix) {
            drawWidgetBox(ctx, widthPx, heightPx, overlays.speed, style, accent, {
                value: formatSpeedValue(pos.speedMs, units),
                unit: overlays.unitSpeed,
                valueScale: 1,
                // Reserve 3 digits (0-999 km/h / mph) so the plate does not breathe
                // as the reading crosses 9->10->100.
                reserveValue: "000",
                // bold style turns this into the hero readout (accent + hazard
                // stripe); min/card draw it plainly.
                hero: true,
            });
        } else {
            // hero: true, matching the reading above - the placeholder stands
            // in for the hero-sized speed readout, not for a plain one.
            drawNoFixBox(ctx, widthPx, heightPx, overlays.speed, style, accent, 1, true);
        }
    }
    if (overlays.coords) {
        if (pos.hasFix) {
            // Two-line "N 55.7521° / E 37.6173°" with accent hemisphere keys.
            drawCoordsBox(ctx, widthPx, heightPx, overlays.coords, style, accent, pos.lat, pos.lon, 0.55);
        } else {
            drawNoFixBox(ctx, widthPx, heightPx, overlays.coords, style, accent, 0.8);
        }
    }
    if (overlays.clock) {
        // Date on top, time below (dim secondary), e.g. "29 Apr 2026 / 18:32:04".
        const c = formatClock(pos.epochSec, overlays.tzOffsetMin, overlays.monthsShort);
        drawWidgetBox(ctx, widthPx, heightPx, overlays.clock, style, accent, {
            value: c.date,
            secondary: c.time,
            valueScale: 0.5,
            secondaryScale: 0.75,
        });
    }
    if (overlays.distance) {
        if (pos.hasFix) {
            drawWidgetBox(ctx, widthPx, heightPx, overlays.distance, style, accent, {
                value: formatDistanceValue(pos.distanceM, units),
                unit: overlays.unitDistance,
                valueScale: 0.85,
                // Reserve 2 integer digits + decimal so the readout holds steady
                // across the 9.9->10.0 step (longer trips just widen the field).
                reserveValue: "88.8",
            });
        } else {
            drawNoFixBox(ctx, widthPx, heightPx, overlays.distance, style, accent, 0.85);
        }
    }
}

/** Dark top+bottom gradient for legibility on bright footage. Drawn before the
 *  widgets, after the video. */
function drawScrim(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    widthPx: number,
    heightPx: number,
): void {
    ctx.save();
    const band = Math.round(heightPx * 0.28);
    const top = ctx.createLinearGradient(0, 0, 0, band);
    top.addColorStop(0, "rgba(0,0,0,0.5)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, widthPx, band);
    const bot = ctx.createLinearGradient(0, heightPx - band, 0, heightPx);
    bot.addColorStop(0, "rgba(0,0,0,0)");
    bot.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = bot;
    ctx.fillRect(0, heightPx - band, widthPx, band);
    ctx.restore();
}

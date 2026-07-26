// Pure decisions of the detector-anchored tracking pass (the "blur all plates /
// faces" checkboxes). The worker (tracker-worker.ts) owns decode + inference;
// this module owns the geometry/time logic around it, so it is unit-testable
// without ort or a decoder:
//
//   - which detector box continues which live track (matchDetectionsToTracks),
//   - whether an accumulated track is a real object or flicker (isTrackConfirmed),
//   - keyframe decimation (shouldEmitKeyframe),
//   - and the final span + backward/forward hold extension (finalizeTrack).
//
// Why this replaced detect-merge's smear/extrapolation: the old pass sampled the
// detector sparsely and GUESSED the between-tick path (constant-velocity walk +
// union smear), which drifted the cover off the object. Here the tracker OBSERVES
// every intermediate frame, so there is nothing to extrapolate - the only
// synthetic motion left is a short backward hold covering the discovery lag
// (approaching, still unreadable), held in place, not velocity-walked.
//
// The privacy asymmetry still rules the defaults: an extra mosaic is cheap, an
// exposed plate is not - when the tracker holds a lock, keep and extend.

import type { CropRect } from "../transcode/compose.js";

/** One emitted keyframe, normalized frame coords, coverage-padded by the caller. */
export interface TrackKeyframe {
    contentSec: number;
    rect: CropRect;
}

/** A confirmed object track, ready to become an auto blur region. detHits and
 *  bestScore are the confirmation evidence, carried into the forensic track
 *  dump for tuning the confirmation thresholds against field reports. */
export interface DetectedTrack {
    startSec: number;
    endSec: number;
    keyframes: TrackKeyframe[];
    detHits: number;
    bestScore: number;
}

/** Intersection-over-union of two normalized rects (0..1). */
export function iou(a: CropRect, b: CropRect): number {
    const ax2 = a.xPct + a.wPct;
    const ay2 = a.yPct + a.hPct;
    const bx2 = b.xPct + b.wPct;
    const by2 = b.yPct + b.hPct;
    const ix = Math.max(a.xPct, b.xPct);
    const iy = Math.max(a.yPct, b.yPct);
    const iw = Math.min(ax2, bx2) - ix;
    const ih = Math.min(ay2, by2) - iy;
    if (iw <= 0 || ih <= 0) return 0;
    const inter = iw * ih;
    const union = a.wPct * a.hPct + b.wPct * b.hPct - inter;
    return union > 0 ? inter / union : 0;
}

/**
 * Greedily matches this detect tick's boxes to the CURRENT boxes of the live
 * tracks (the caller advances each tracker one step before calling, so the boxes
 * are current - a match means "the tracker followed this object to where the
 * detector now sees it"). One detection per track, one track per detection,
 * highest-overlap pairs first. Returns, per detection index, the matched track
 * index or -1 (a fresh object to seed).
 *
 * IoU (not center distance) because it is scale-invariant: an approaching plate
 * grows between anchors, and the tracker's box grows with it, so overlap stays
 * high while an absolute-distance gate would need per-speed tuning.
 */
export function matchDetectionsToTracks(
    detections: readonly CropRect[],
    trackBoxes: readonly CropRect[],
    opts: { minIou: number },
): number[] {
    const pairs: Array<{ det: number; track: number; iou: number }> = [];
    for (let det = 0; det < detections.length; det++) {
        for (let track = 0; track < trackBoxes.length; track++) {
            const v = iou(detections[det]!, trackBoxes[track]!);
            if (v >= opts.minIou) pairs.push({ det, track, iou: v });
        }
    }
    pairs.sort((a, b) => b.iou - a.iou);
    const matchedTrackOf = new Array<number>(detections.length).fill(-1);
    const trackTaken = new Set<number>();
    for (const p of pairs) {
        if (matchedTrackOf[p.det] !== -1 || trackTaken.has(p.track)) continue;
        matchedTrackOf[p.det] = p.track;
        trackTaken.add(p.track);
    }
    return matchedTrackOf;
}

/** What confirmation reads off an accumulating track. */
export interface TrackConfirmState {
    /** Number of detector hits that landed on this track (seed + re-anchors). */
    detHits: number;
    /** Best detector score seen on this track. */
    bestScore: number;
    /** Cumulative seconds the tracker held a confident lock on this track. */
    trackedGoodSec: number;
}

export interface ConfirmOptions {
    /** Confirmed with at least this many detector hits... */
    confirmMinHits: number;
    /** ...or one hit at/above this score (an unmistakable single detection)... */
    confirmStrongScore: number;
    /** ...or the tracker held a lock at least this long. This is the corroboration
     *  a single weak detection needs at 1 fps discovery: a real object lets the
     *  tracker follow it, flicker does not - so tracker-sustain replaces the old
     *  "needs 2 detector hits", which sparse discovery could not always deliver. */
    confirmTrackSec: number;
}

/** True when an accumulated track is a real object, not detector flicker. */
export function isTrackConfirmed(state: TrackConfirmState, opts: ConfirmOptions): boolean {
    return (
        state.detHits >= opts.confirmMinHits ||
        state.bestScore >= opts.confirmStrongScore ||
        state.trackedGoodSec >= opts.confirmTrackSec
    );
}

/** True when a new box is worth emitting as a keyframe: enough time passed, or it
 *  moved enough. Keeps the keyframe stream sparse without dropping real motion. */
export function shouldEmitKeyframe(
    lastEmit: TrackKeyframe | null,
    contentSec: number,
    rect: CropRect,
    opts: { minIntervalSec: number; minMovePct: number },
): boolean {
    if (!lastEmit) return true;
    if (contentSec - lastEmit.contentSec >= opts.minIntervalSec) return true;
    return (
        Math.abs(rect.xPct - lastEmit.rect.xPct) > opts.minMovePct ||
        Math.abs(rect.yPct - lastEmit.rect.yPct) > opts.minMovePct ||
        Math.abs(rect.wPct - lastEmit.rect.wPct) > opts.minMovePct ||
        Math.abs(rect.hPct - lastEmit.rect.hPct) > opts.minMovePct
    );
}

export interface FinalizeOptions extends ConfirmOptions {
    /** The cover starts this much before the first keyframe, holding the first
     *  rect in place (no velocity walk - see the header). Bridges the discovery
     *  lag: the object was approaching but too small/far to detect yet. */
    extendBackSec: number;
    /** ...and ends this much after the last one, holding the last rect (covers
     *  the object between the last confident position and where it left). */
    extendForwardSec: number;
    /** Clamp bounds - the analyzed interval. A span leaking outside it would blur
     *  frames the pass never looked at (or, incrementally, another interval's). */
    clampStartSec: number;
    clampEndSec: number;
}

/** What the worker accumulates per live track and hands to finalizeTrack. */
export interface TrackAccumulator extends TrackConfirmState {
    /** Dense, time-sorted, already coverage-padded keyframes (tracker steps +
     *  re-anchored detector boxes). */
    keyframes: TrackKeyframe[];
}

/**
 * Turns an accumulated track into a final span, or null when it never confirmed
 * (flicker - drop it, emit nothing). Prepends a backward hold keyframe and
 * appends a forward one, both holding the edge rect in place and clamped to the
 * analyzed interval. Assumes keyframes are time-sorted and non-empty on a
 * confirmed track.
 */
export function finalizeTrack(acc: TrackAccumulator, opts: FinalizeOptions): DetectedTrack | null {
    if (!isTrackConfirmed(acc, opts)) return null;
    if (acc.keyframes.length === 0) return null;
    const kfs = [...acc.keyframes];
    const first = kfs[0]!;
    const backAt = Math.max(opts.clampStartSec, first.contentSec - opts.extendBackSec);
    if (backAt < first.contentSec) kfs.unshift({ contentSec: backAt, rect: { ...first.rect } });
    const last = kfs[kfs.length - 1]!;
    const fwdAt = Math.min(opts.clampEndSec, last.contentSec + opts.extendForwardSec);
    if (fwdAt > last.contentSec) kfs.push({ contentSec: fwdAt, rect: { ...last.rect } });
    return {
        startSec: kfs[0]!.contentSec,
        endSec: kfs[kfs.length - 1]!.contentSec,
        keyframes: kfs,
        detHits: acc.detHits,
        bestScore: acc.bestScore,
    };
}

// Encode budget for the re-encode export path: how many bits per second the
// H.264 encoder is asked for, per quality tier.
//
// Pure arithmetic, no UI and no mediabunny - so the numbers can be unit-tested
// and so the export panel's estimate and the real export can never diverge (both
// call reencodeBitrateForQuality).
//
// Three things the budget has to respect, all of which the earlier flat
// constants got wrong:
//
//  - Resolution. Every bound is bits-per-pixel-second, so a 4K frame gets a 4K
//    budget. A flat ceiling in bps silently starved high-resolution exports:
//    at 4K it landed below the formula's own floor, so every 4K export came out
//    at the ceiling no matter what the camera recorded.
//  - Frame rate. The per-pixel constants are calibrated at REFERENCE_FPS; a
//    60 fps source needs twice the bits per second for the same per-frame
//    quality, and 1080p60 is a mainstream dashcam mode.
//  - Generation loss. Re-encoding decoded frames is never free: the frames make
//    a round trip through an 8-bit RGB canvas (chroma resampled down, up and
//    down again) and the browser's H.264 encoder emits no B-frames, so at the
//    source's own bitrate the result is visibly softer than the source. The top
//    tier asks for headroom over the source rather than matching it.

/** Bitrate quality preset. Mirrors the export panel's radio group. */
export type BitrateQuality = "original" | "medium" | "low";

// Frame rate the per-pixel constants below are calibrated at. A source at
// another rate scales the whole budget proportionally.
const REFERENCE_FPS = 30;

// Lower bound in bits per pixel-second at REFERENCE_FPS. Calibrated for the
// high-motion, high-detail content a dashcam records: 720p -> 3.7 Mbps,
// 1080p -> 8.3 Mbps. A source that was recorded below this is not re-encoded
// even lower, or a second generation of an already-thin stream falls apart.
const FLOOR_BITS_PER_PIXEL_SECOND = 4;

// Upper bound, same shape. 12 puts a 1080p30 ceiling at ~25 Mbps (the value
// that used to be hard-coded for every resolution) while letting 4K reach the
// tens of Mbps a 4K camera actually writes. This is a sanity bound on an absurd
// request, not the working target - the target is the source-derived figure
// below, which for real footage lands well under it.
const CEILING_BITS_PER_PIXEL_SECOND = 12;

// Headroom over the measured source bitrate for the top tier. Covers the
// round-trip and B-frame losses described above, so "as close to the original
// as possible" is close in the picture rather than only in the numbers. Not
// higher: the multiplier is the smallest of the levers here and it is paid in
// full on every exported byte.
const TOP_TIER_HEADROOM = 1.3;

// The size-saver tiers, as fractions of the (ceiling-clamped) source bitrate.
// Deliberately NOT floored at FLOOR_BITS_PER_PIXEL_SECOND: dropping below the
// floor is the entire point of a size-saver, and the floor would make "medium"
// exceed a source that was already thinner than it.
const SAVER_FACTOR: Record<Exclude<BitrateQuality, "original">, number> = {
    medium: 0.6,
    low: 0.35,
};

/** Bounds of the manual bitrate input, in Mbit/s. The ceiling is far above any
 *  plausible request - it exists to stop a typo from asking for a terabit, not
 *  to express an opinion. What the device can really encode is settled by the
 *  encoder probe, which still runs on a manual value. */
export const MANUAL_BITRATE_MIN_MBPS = 1;
export const MANUAL_BITRATE_MAX_MBPS = 400;

/**
 * Clamps a user-entered manual bitrate to the allowed range, or returns null
 * for anything that is not a usable number (empty field, NaN) - null means
 * "auto", i.e. fall back to the tier's computed budget.
 */
export function clampManualBitrateMbps(value: number): number | null {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(MANUAL_BITRATE_MAX_MBPS, Math.max(MANUAL_BITRATE_MIN_MBPS, Math.round(value)));
}

/** Scale factor applied to every per-pixel bound for a source frame rate.
 *  A null/implausible rate falls back to the reference, i.e. no scaling. */
function fpsScale(sourceFps: number | null): number {
    if (sourceFps === null || !Number.isFinite(sourceFps) || sourceFps <= 0) return 1;
    return sourceFps / REFERENCE_FPS;
}

/**
 * Video bitrate (bps) a quality tier targets on the re-encode path.
 *
 * `sourceBitrate` is the measured average rate of the footage the range covers
 * (see rangeSourceBitrateBps) and `sourceFps` its frame rate; both may be 0 /
 * null on a source we could not measure, in which case the tier falls back to
 * the pixel-area bounds alone.
 *
 * "original" (the panel's top tier, labelled Original when it can stream-copy
 * and High when a crop / overlay / resize / split / speed forces a re-encode)
 * asks for the source rate plus headroom, bounded by the per-pixel floor and
 * ceiling. "medium" / "low" take a fraction of the ceiling-clamped source, so
 * they always come out below it and still scale with the real footage.
 *
 * width/height are the OUTPUT dimensions and must be positive. The three tiers
 * are monotonic (original >= medium >= low) at every input.
 */
export function reencodeBitrateForQuality(
    quality: BitrateQuality,
    width: number,
    height: number,
    sourceBitrate: number,
    sourceFps: number | null,
): number {
    const pixelSeconds = width * height * fpsScale(sourceFps);
    const floor = pixelSeconds * FLOOR_BITS_PER_PIXEL_SECOND;
    const ceiling = pixelSeconds * CEILING_BITS_PER_PIXEL_SECOND;
    const source = Number.isFinite(sourceBitrate) && sourceBitrate > 0 ? sourceBitrate : 0;
    if (quality === "original") {
        return Math.round(Math.min(Math.max(source * TOP_TIER_HEADROOM, floor), ceiling));
    }
    const clampedSource = Math.min(source, ceiling);
    return Math.round(clampedSource * SAVER_FACTOR[quality]);
}

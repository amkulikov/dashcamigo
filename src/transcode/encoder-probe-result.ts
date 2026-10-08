export interface EncoderProbeConfig {
    width: number;
    height: number;
    frameRate: number;
    bitrate: number;
}

export interface EncoderProbeMeasurement {
    bitrate: number;
    frames: number;
    expectedFrames: number;
    duration: number;
    elapsedMs: number;
    psnr: number | null;
}

export interface EncoderProbeResult {
    hardwareAcceleration: "no-preference" | "prefer-software";
    reason: "healthy" | "confirmed" | "unresponsive" | "inconclusive";
    standard: EncoderProbeMeasurement | null;
    software: EncoderProbeMeasurement | null;
    response: { bitrate: number; measurement: EncoderProbeMeasurement } | null;
}

export function hasPoorEncoderQuality(measurement: EncoderProbeMeasurement): boolean {
    return measurement.psnr !== null && Number.isFinite(measurement.psnr) && measurement.psnr < 30;
}

function isComplete(measurement: EncoderProbeMeasurement): boolean {
    return (
        measurement.frames === measurement.expectedFrames &&
        measurement.frames > 0 &&
        Number.isFinite(measurement.bitrate) &&
        measurement.bitrate > 0 &&
        Number.isFinite(measurement.duration) &&
        measurement.duration > 0
    );
}

/** A severe undershoot only opens the quality check; it never selects an encoder alone. */
export function isEncoderBitrateSuspicious(measurement: EncoderProbeMeasurement, target: number): boolean {
    return isComplete(measurement) && measurement.bitrate < target * 0.35;
}

function softwareQualityGain(
    standard: EncoderProbeMeasurement,
    software: EncoderProbeMeasurement,
    target: number,
): number | null {
    if (
        !isEncoderBitrateSuspicious(standard, target) ||
        !isComplete(software) ||
        !hasPoorEncoderQuality(standard) ||
        standard.psnr === null ||
        software.psnr === null ||
        !Number.isFinite(software.psnr) ||
        software.bitrate < target * 0.65 ||
        software.bitrate > target * 1.5
    )
        return null;
    return software.psnr - standard.psnr;
}

export function shouldProbeEncoderResponse(
    standard: EncoderProbeMeasurement,
    software: EncoderProbeMeasurement,
    target: number,
): boolean {
    const gain = softwareQualityGain(standard, software, target);
    return gain !== null && gain >= 0.5 && gain < 2;
}

export function shouldUseSoftwareEncoder(
    standard: EncoderProbeMeasurement,
    software: EncoderProbeMeasurement,
    target: number,
    response: EncoderProbeResult["response"] = null,
): boolean {
    const gain = softwareQualityGain(standard, software, target);
    if (gain === null || gain < 0.5) return false;
    // Two decibels remove over a third of the measured squared error.
    if (gain >= 2) return true;
    // A smaller gain needs evidence that doubling the budget cannot restore default quality.
    if (!response || !Number.isFinite(response.bitrate) || response.bitrate < target * 2) return false;
    const higher = response.measurement;
    return (
        isComplete(higher) &&
        hasPoorEncoderQuality(higher) &&
        higher.expectedFrames === standard.expectedFrames &&
        Math.abs(higher.duration - standard.duration) < 1e-6 &&
        Math.abs(higher.bitrate / standard.bitrate - 1) <= 0.05 &&
        higher.psnr !== null &&
        standard.psnr !== null &&
        Math.abs(higher.psnr - standard.psnr) <= 0.25
    );
}

/** Compare luminance in the same canvas color space, including fine texture. */
export function luminanceSquaredError(reference: Uint8ClampedArray, decoded: Uint8ClampedArray): number {
    if (reference.length !== decoded.length || reference.length === 0 || reference.length % 4 !== 0)
        throw new Error("invalid quality comparison pixels");
    let error = 0;
    for (let i = 0; i < reference.length; i += 4) {
        const delta =
            0.2126 * (reference[i]! - decoded[i]!) +
            0.7152 * (reference[i + 1]! - decoded[i + 1]!) +
            0.0722 * (reference[i + 2]! - decoded[i + 2]!);
        error += delta * delta;
    }
    return error / (reference.length / 4);
}

import { describe, expect, it } from "vitest";
import {
    isEncoderBitrateSuspicious,
    luminanceSquaredError,
    shouldProbeEncoderResponse,
    shouldUseSoftwareEncoder,
    type EncoderProbeMeasurement,
} from "./encoder-probe-result.js";

const standard: EncoderProbeMeasurement = {
    bitrate: 4_000_000,
    frames: 50,
    expectedFrames: 50,
    duration: 2,
    elapsedMs: 1000,
    psnr: 23,
};
const software: EncoderProbeMeasurement = { ...standard, bitrate: 32_000_000, elapsedMs: 5000, psnr: 34 };

describe("encoder selection evidence", () => {
    it("selects software after severe undershoot and confirmed loss of detail regardless of speed", () => {
        expect(shouldUseSoftwareEncoder(standard, software, 32_000_000)).toBe(true);
        expect(shouldUseSoftwareEncoder(standard, { ...software, elapsedMs: 100_000 }, 32_000_000)).toBe(true);
    });

    it("keeps efficient output when its image retains detail despite a low bitrate", () => {
        expect(isEncoderBitrateSuspicious(standard, 32_000_000)).toBe(true);
        expect(shouldUseSoftwareEncoder({ ...standard, psnr: 40 }, { ...software, psnr: 44 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder({ ...standard, bitrate: 30_000_000 }, software, 32_000_000)).toBe(false);
    });

    it("requires a meaningful quality improvement and a usable output size", () => {
        expect(shouldUseSoftwareEncoder(standard, { ...software, psnr: 24 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder(standard, { ...software, bitrate: 60_000_000 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder(standard, { ...software, bitrate: 8_000_000 }, 32_000_000)).toBe(false);
    });

    it("retains the default when frames or reliable quality measurements are missing", () => {
        for (const change of [{ frames: 49 }, { duration: 0 }, { psnr: null }, { psnr: Number.NaN }, { bitrate: 0 }]) {
            expect(shouldUseSoftwareEncoder({ ...standard, ...change }, software, 32_000_000)).toBe(false);
            expect(shouldUseSoftwareEncoder(standard, { ...software, ...change }, 32_000_000)).toBe(false);
        }
    });
});

describe("encoder bitrate response", () => {
    const mediumStandard = { ...standard, bitrate: 3_800_000, psnr: 23.7 };
    const mediumSoftware = { ...software, bitrate: 23_600_000, psnr: 24.45 };
    const target = 19_300_000;
    const response = { bitrate: target * 2, measurement: mediumStandard };

    it.each([
        { target, standard: mediumStandard, software: mediumSoftware },
        {
            target: 26_900_000,
            standard: { ...standard, bitrate: 4_350_000, psnr: 23.7 },
            software: { ...software, bitrate: 33_600_000, psnr: 24.85 },
        },
    ])("selects a smaller quality gain only after the default ignores a doubled target ($target)", (trial) => {
        expect(shouldProbeEncoderResponse(trial.standard, trial.software, trial.target)).toBe(true);
        expect(shouldUseSoftwareEncoder(trial.standard, trial.software, trial.target)).toBe(false);
        expect(
            shouldUseSoftwareEncoder(trial.standard, trial.software, trial.target, {
                bitrate: trial.target * 2,
                measurement: trial.standard,
            }),
        ).toBe(true);
    });

    it("does not spend another trial when the direct comparison already settles the choice", () => {
        expect(shouldProbeEncoderResponse(standard, software, 32_000_000)).toBe(false);
        expect(shouldProbeEncoderResponse({ ...standard, psnr: 40 }, software, 32_000_000)).toBe(false);
        expect(shouldProbeEncoderResponse({ ...standard, bitrate: 30_000_000 }, software, 32_000_000)).toBe(false);
    });

    it("keeps the default when more budget improves its quality or changes its output rate", () => {
        for (const change of [{ psnr: 24.5 }, { bitrate: 6_000_000 }, { bitrate: 3_000_000 }]) {
            expect(
                shouldUseSoftwareEncoder(mediumStandard, mediumSoftware, target, {
                    ...response,
                    measurement: { ...mediumStandard, ...change },
                }),
            ).toBe(false);
        }
    });

    it("rejects missing, incomparable or incomplete response measurements", () => {
        for (const change of [
            { frames: 49 },
            { frames: 60, expectedFrames: 60 },
            { duration: 1 },
            { psnr: null },
            { psnr: Number.NaN },
            { psnr: Infinity },
            { bitrate: 0 },
        ]) {
            expect(
                shouldUseSoftwareEncoder(mediumStandard, mediumSoftware, target, {
                    ...response,
                    measurement: { ...mediumStandard, ...change },
                }),
            ).toBe(false);
        }
        for (const bitrate of [target, target * 1.5, Number.NaN, Infinity]) {
            expect(shouldUseSoftwareEncoder(mediumStandard, mediumSoftware, target, { ...response, bitrate })).toBe(
                false,
            );
        }
    });

    it("does not choose oversized or worse software output even when the default ignores bitrate", () => {
        for (const trial of [
            { target: 11_300_000, software: { ...software, bitrate: 17_200_000, psnr: 23.45 } },
            { target: 15_700_000, software: { ...software, bitrate: 26_200_000, psnr: 24.43 } },
            { target, software: { ...mediumSoftware, psnr: 23.9 } },
            { target, software: { ...mediumSoftware, bitrate: 8_000_000 } },
            { target, software: { ...mediumSoftware, frames: 49 } },
        ]) {
            expect(shouldProbeEncoderResponse(mediumStandard, trial.software, trial.target)).toBe(false);
            expect(
                shouldUseSoftwareEncoder(mediumStandard, trial.software, trial.target, {
                    ...response,
                    bitrate: trial.target * 2,
                }),
            ).toBe(false);
        }
    });
});

describe("luminance error", () => {
    it("preserves an exact match and ignores the unused alpha channel", () => {
        expect(
            luminanceSquaredError(new Uint8ClampedArray([20, 30, 40, 255]), new Uint8ClampedArray([20, 30, 40, 0])),
        ).toBe(0);
    });

    it("measures missing fine detail even when average brightness is unchanged", () => {
        expect(
            luminanceSquaredError(
                new Uint8ClampedArray([90, 90, 90, 255, 110, 110, 110, 255]),
                new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]),
            ),
        ).toBeCloseTo(100);
    });
});

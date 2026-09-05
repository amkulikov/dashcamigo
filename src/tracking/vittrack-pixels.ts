// OpenCV blobFromImageWithParams: BGR planes, swapRB=false. Byte lookups
// retain the same Float32 rounding as evaluating (p / 255 - mean) / std.
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const normalizedBlue = Float32Array.from({ length: 256 }, (_, value) => (value / 255 - MEAN[0]) / STD[0]);
const normalizedGreen = Float32Array.from({ length: 256 }, (_, value) => (value / 255 - MEAN[1]) / STD[1]);
const normalizedRed = Float32Array.from({ length: 256 }, (_, value) => (value / 255 - MEAN[2]) / STD[2]);

export function packBgrPlanarStandardized(rgba: Uint8ClampedArray, target: Float32Array): void {
    const n = rgba.length / 4;
    for (let i = 0; i < n; i++) {
        target[i] = normalizedBlue[rgba[i * 4 + 2]!]!;
        target[n + i] = normalizedGreen[rgba[i * 4 + 1]!]!;
        target[2 * n + i] = normalizedRed[rgba[i * 4]!]!;
    }
}

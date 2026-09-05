import { describe, expect, it } from "vitest";
import type { RawDetection } from "./detect-common.js";
import { collectFaceDetections } from "./face-detector.js";
import { collectPlateDetections } from "./plate-detector.js";

const geometry = {
    lb: { scale: 0.5, dx: 10, dy: 20 },
    tile: { sx: 100, sy: 200, sw: 400, sh: 200 },
    frameW: 1000,
    frameH: 1000,
};

describe("detector output mapping", () => {
    it("maps channels-first faces and applies the width floor in frame pixels", () => {
        const detections: RawDetection[] = [];
        collectFaceDetections(
            {
                ...geometry,
                dims: [1, 5, 3],
                data: new Float32Array([50, 70, 90, 40, 40, 40, 10, 9, 10, 20, 20, 20, 0.25, 0.9, 0.24]),
            },
            detections,
        );
        expect(detections).toEqual([{ x: 170, y: 220, w: 20, h: 40, score: 0.25 }]);
    });

    it("maps plate rows and drops low scores and whole-vehicle boxes", () => {
        const detections: RawDetection[] = [];
        collectPlateDetections(
            {
                ...geometry,
                dims: [3, 7],
                data: new Float32Array([
                    0, 20, 30, 60, 40, 0, 0.25, 0, 20, 30, 220, 40, 0, 0.9, 0, 20, 30, 60, 40, 0, 0.24,
                ]),
            },
            detections,
        );
        expect(detections).toEqual([{ x: 120, y: 220, w: 80, h: 20, score: 0.25 }]);
    });
});

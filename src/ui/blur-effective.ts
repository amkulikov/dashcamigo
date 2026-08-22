// The redaction set the user actually sees: hand-drawn zones plus fresh
// plate/face detection results. Keep this composition in one place so preview,
// still-frame capture and export cannot quietly disagree about privacy.

import type { BlurRegion } from "../blur-regions.js";

import { detectRegions } from "./blur-detect.js";
import { activeBlurRegions } from "./blur-regions-state.js";

/** Live effective regions of the active trip. Do not retain across edits. */
export function activeEffectiveBlurRegions(): BlurRegion[] {
    return [...activeBlurRegions(), ...detectRegions()];
}

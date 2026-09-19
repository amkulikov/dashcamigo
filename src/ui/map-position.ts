import { interpolatePosition } from "../parser.js";
import type { GpsRecord, InterpolatedPosition } from "../parsers/types.js";
import { hasFixAt } from "../transcode/frame-pos.js";

/** Match export coverage so a long dropout never moves the car through an invented location. */
export function mapPositionAt(records: GpsRecord[], targetUnix: number): InterpolatedPosition | null {
    const position = interpolatePosition(records, targetUnix);
    return position && hasFixAt(records, targetUnix) ? position : null;
}

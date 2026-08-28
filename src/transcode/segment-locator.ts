/** Minimal timeline shape needed by the split-screen segment cursor. */
export interface TimedSegment {
    tripStart: number;
    startInFile: number;
    endInFile: number;
}

export interface MonotonicSegmentCursor {
    /** First segment that can still contain a future timestamp. */
    locatorSegmentIdx: number;
}

const SEGMENT_TIME_EPSILON_SEC = 1e-6;

/**
 * Finds the segment containing a monotonically increasing trip timestamp.
 * Segments left behind are skipped once, making a whole export O(frames +
 * segments). A gap returns -1 without moving past its next segment, so the
 * caller can retain/freeze its last decoded frame until footage resumes.
 */
export function locateMonotonicSegment(
    segments: readonly TimedSegment[],
    tripTimeSec: number,
    cursor: MonotonicSegmentCursor,
): number {
    while (cursor.locatorSegmentIdx < segments.length) {
        const idx = cursor.locatorSegmentIdx;
        const segment = segments[idx]!;
        const start = segment.tripStart + segment.startInFile;
        const end = segment.tripStart + segment.endInFile;
        if (tripTimeSec >= start - SEGMENT_TIME_EPSILON_SEC && tripTimeSec < end + SEGMENT_TIME_EPSILON_SEC) {
            return idx;
        }
        if (tripTimeSec < start) return -1;
        cursor.locatorSegmentIdx++;
    }
    return -1;
}

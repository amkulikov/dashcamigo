// Time-interval set arithmetic for the incremental detection pass: the client
// caches raw detection ticks per analyzed interval, and a range edit analyzes
// only the sub-ranges the cache does not cover (a shrunk range analyzes
// nothing - the tracks just re-merge from cached ticks). Pure time logic, no
// DOM, no worker deps.

export interface TimeInterval {
    startSec: number;
    endSec: number;
}

/** Sliver floor: a gap or leftover shorter than this is not worth a decode
 *  pass and gets merged away / dropped. Also absorbs float noise from range
 *  keys (they round to 0.01 s). */
export const INTERVAL_EPS_SEC = 0.05;

/** Normalized union: sorted, non-overlapping, gaps under the sliver floor
 *  closed, degenerate intervals dropped. */
export function unionIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
    const sorted = intervals
        .filter((intervalItem) => intervalItem.endSec - intervalItem.startSec > 0)
        .sort((a, b) => a.startSec - b.startSec);
    const out: TimeInterval[] = [];
    for (const intervalItem of sorted) {
        const last = out[out.length - 1];
        if (last && intervalItem.startSec <= last.endSec + INTERVAL_EPS_SEC) {
            last.endSec = Math.max(last.endSec, intervalItem.endSec);
        } else {
            out.push({ ...intervalItem });
        }
    }
    return out;
}

/** Parts of `range` not covered by `covered`. Slivers below the floor are
 *  dropped - re-analyzing 30 ms of video buys nothing. */
export function subtractIntervals(range: TimeInterval, covered: readonly TimeInterval[]): TimeInterval[] {
    const out: TimeInterval[] = [];
    let cursor = range.startSec;
    for (const coveredItem of unionIntervals(covered)) {
        if (coveredItem.endSec <= range.startSec) continue;
        if (coveredItem.startSec >= range.endSec) break;
        if (coveredItem.startSec - cursor > INTERVAL_EPS_SEC) {
            out.push({ startSec: cursor, endSec: coveredItem.startSec });
        }
        cursor = Math.max(cursor, coveredItem.endSec);
    }
    if (range.endSec - cursor > INTERVAL_EPS_SEC) {
        out.push({ startSec: cursor, endSec: range.endSec });
    }
    return out;
}

/** Summed length of a normalized interval list. */
export function totalIntervalSec(intervals: readonly TimeInterval[]): number {
    let total = 0;
    for (const intervalItem of intervals) total += Math.max(0, intervalItem.endSec - intervalItem.startSec);
    return total;
}

/** True when `sec` lies inside one of the intervals (eps-tolerant at the
 *  edges - a decoded frame timestamped a hair outside its interval still
 *  belongs to it). */
export function intervalsContain(intervals: readonly TimeInterval[], sec: number): boolean {
    return intervals.some(
        (intervalItem) =>
            sec >= intervalItem.startSec - INTERVAL_EPS_SEC && sec <= intervalItem.endSec + INTERVAL_EPS_SEC,
    );
}

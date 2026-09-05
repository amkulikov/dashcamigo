import type { TimeInterval } from "./interval-set.js";

/** Each detector owns its interval boundaries even when another detector keeps
 *  the shared decoder running across its cached gap. Interval objects are kept
 *  by reference so callers can reset scan cadence only when entering a span. */
export function analysisIntervalTransition(
    previous: TimeInterval | null,
    intervals: readonly TimeInterval[],
    contentSec: number,
): { active: TimeInterval | null; finished: TimeInterval | null; started: boolean } {
    const active =
        intervals.find((interval) => contentSec >= interval.startSec && contentSec < interval.endSec) ?? null;
    return {
        active,
        finished: previous !== active ? previous : null,
        started: active !== null && active !== previous,
    };
}

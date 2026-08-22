/**
 * Builds a UTC timestamp without JavaScript's calendar rollover. A parser that
 * reads February 31 or April 31 has decoded corrupt bytes and must reject the
 * record instead of silently moving it into the next month.
 */
export function utcMillisecondsFromParts(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    allowLeapSecond = false,
): number | null {
    if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
    if (year < 100 || year > 9999) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const isLeapSecond = allowLeapSecond && second === 60;
    if (second < 0 || second > (allowLeapSecond ? 60 : 59)) return null;

    const normalizedSecond = isLeapSecond ? 59 : second;
    const ms = Date.UTC(year, month - 1, day, hour, minute, normalizedSecond);
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute ||
        date.getUTCSeconds() !== normalizedSecond
    ) {
        return null;
    }
    return isLeapSecond ? ms + 1000 : ms;
}

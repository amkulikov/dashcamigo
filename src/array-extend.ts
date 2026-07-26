// Stack-safe in-place array append.
//
// `target.push(...source)` passes every element of `source` as a separate call
// argument. Engines cap that argument count (~125k in V8); a whole-card 70mai
// GPS log is 130k+ rows, so aggregating one such file's parsed records with the
// spread form throws "RangeError: Maximum call stack size exceeded" and aborts
// the entire ingest. An index loop has no argument-count ceiling.
//
// Used everywhere a parser-returned array (records / skipped lines) is merged
// into an accumulator across files or worker results - the spots that scale
// with footage length, not with a fixed small count.

/**
 * Appends every element of `source` onto `target` in place, in order, without
 * the unbounded `target.push(...source)` spread. No-op for an empty source.
 * Returns nothing - mutates `target`.
 */
export function extendArray<T>(target: T[], source: readonly T[]): void {
    for (let i = 0; i < source.length; i++) {
        target.push(source[i]!);
    }
}

/** True for the exception shapes a too-large in-memory export throws when the
 *  engine cannot allocate the MP4 buffer: a RangeError ("Array buffer allocation
 *  failed" in V8, "Out of memory" in JSC) or any error whose message names an
 *  out-of-memory / allocation failure. Lets the export catch turn the raw throw
 *  into the "too large for this browser, use desktop Chrome" guidance instead of
 *  leaking an opaque message.
 *
 *  Pure and DOM-free on purpose so the matcher is unit-testable - the no-native
 *  RAM path has no pre-cap, so this predicate is the only thing standing between
 *  an oversized export and an opaque error toast. */
export function isAllocationFailure(err: unknown): boolean {
    if (err instanceof RangeError) return true;
    const message = err instanceof Error ? err.message : String(err);
    // Engine-specific OOM wording thrown as a plain Error (not RangeError):
    // V8 "Array buffer allocation failed", JSC "Out of memory", SpiderMonkey
    // "out of memory" / "allocation size overflow".
    return /out of memory|allocation (?:failed|size overflow)|array buffer|memory exhausted/i.test(message);
}

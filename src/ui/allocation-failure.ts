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
    const message = err instanceof Error ? err.message : String(err);
    // Engine wording for an allocation that could not be satisfied. V8: "Array
    // buffer allocation failed", "Invalid typed array length", "Invalid string
    // length"; JSC: "Out of memory"; SpiderMonkey: "out of memory" /
    // "allocation size overflow".
    if (
        /out of memory|allocation (?:failed|size overflow)|array buffer|memory exhausted|invalid (?:typed array|string) length/i.test(
            message,
        )
    ) {
        return true;
    }
    // A RangeError with our own over-4-GiB wording, whichever way it arrives -
    // as the real subclass on this thread, or rebuilt from worker-port data
    // where only name and message survive. The RangeError SHAPE alone is not
    // enough either way: a demuxer range check on a corrupt container throws
    // one too, and calling that "too large for your browser's memory" sends the
    // user hunting for RAM to open a broken file.
    const name = err instanceof Error ? err.name : (err as { name?: unknown } | null)?.name;
    return name === "RangeError" && /too large|exceeds|4 ?gib|maximum size/i.test(message);
}

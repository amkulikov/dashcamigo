/** True for the exception shapes a failed SOURCE-file read produces - the user's
 *  memory card / drive dropped mid-export, or the file changed on disk since it
 *  was picked (browsers snapshot size+mtime and refuse a stale read):
 *  - Chromium reads the File through blob.stream(); a failed read errors the
 *    stream with exactly `TypeError: network error` (BodyStreamBuffer's literal,
 *    confirmed against Blink source - it is NOT an HTTP failure despite the text).
 *  - The FileReader / blob.arrayBuffer() path (WebKit fallback, workers) surfaces
 *    the same failure as a NotReadableError DOMException instead.
 *  Lets the export catch tell the user "check your card/drive" instead of the
 *  generic "something went wrong".
 *
 *  Pure (aside from the DOMException global) so the matcher is unit-testable. */
export function isSourceReadError(err: unknown): boolean {
    // Chromium blob.stream() shape. Exact match - "network error" is the fixed
    // Blink literal, and anything looser would swallow real fetch failures.
    // The name, not just instanceof: an error rebuilt from worker-port data is
    // a plain Error carrying the original name, and the re-encode export
    // reports exactly that copy.
    const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
    if (name === "TypeError" && err instanceof Error && err.message === "network error") return true;
    // FileReader / arrayBuffer shape, incl. wrapped/re-thrown variants where the
    // DOMException subclass is lost but the name survives (worker forwarding).
    if (name === "NotReadableError") return true;
    // Last resort: the Chromium/WebKit NotReadableError message text, kept narrow
    // to avoid false positives on unrelated "read" wording.
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /requested file could not be read/.test(message);
}

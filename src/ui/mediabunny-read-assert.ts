/**
 * mediabunny's internal `assert()` helper throws exactly `new Error("Assertion
 * failed.")` (node_modules/mediabunny/src/misc.ts). We have seen it fire in
 * production from the stream-copy read path - EncodedPacketSink.getNextPacket ->
 * Reader.requestSlice -> ReadOrchestrator.read - i.e. a broken internal
 * read-cache invariant while copying a particular file's packets. It is not our
 * misuse (the export path uses a plain single-owner BlobSource, read
 * sequentially, disposed only after the loop) and there is no upstream fix
 * through mediabunny 1.50.x.
 *
 * A deep trace (2026-07) placed the throw in ReadOrchestrator.read's
 * cache-coverage assert (source.ts 1851/1896: outer/prefetch coverage disagrees
 * with inner contiguous fill, which requires two OVERLAPPING cache entries) but
 * could NOT construct the insert sequence that produces such an overlap from the
 * 1.48.1 code - insertIntoCache keeps the cache sorted+disjoint - so the exact
 * mechanism is unproven. Crucially the crash fires during the VIDEO-ONLY sweep
 * (before the audio sink reads), so the trigger is a SINGLE sink + its own
 * prefetch workers, NOT the video/audio cache sharing - so splitting video/audio
 * onto separate Inputs would NOT reliably fix it (rejected). The only change that
 * removes 1851/1896 by construction is maxCacheSize:0 on the export BlobSource
 * (empty cache -> no coverage to disagree over), at a read-coalescing cost, and
 * even that may only mask if the diagnosis is incomplete. So we do NOT swallow it
 * (treating it as clean EOS would silently save a truncated clip - the assert is
 * an early read, not a tail); we only RECOGNIZE it, giving the crash its own
 * Sentry signal (fingerprint + tag) to watch frequency. Real fix needs an
 * upstream report to mediabunny + a repro file.
 *
 * The match is intentionally narrow - a plain `Error` whose message is exactly
 * the assert text - and is only ever consulted on the stream-copy failure path,
 * so a stray "Assertion failed." from unrelated code is not misattributed.
 */
export function isMediabunnyReadAssert(err: unknown): boolean {
    return err instanceof Error && err.name === "Error" && err.message === "Assertion failed.";
}

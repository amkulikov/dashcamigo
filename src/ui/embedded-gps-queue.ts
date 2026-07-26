// Per-file decision for the ingest embedded-GPS stage: should this indexed
// file be handed to the extraction batch, and are its moov bytes worth caching
// for the worker. Pure (no DOM/worker deps) so the ingest wiring stays unit-
// testable - the queue rule below is load-bearing.

import { shouldTryEmbeddedGps } from "../parsers/gps-source-hints.js";
import type { VendorFile } from "../parsers/types.js";

export interface EmbeddedGpsQueuePlan {
    // Hand this file to dispatchParseVideoEmbeddedGps.
    queue: boolean;
    // Cache the file's moov bytes for the extraction worker so it skips a second
    // moov read on cold SD. A pure optimization layered on top of `queue`.
    cacheMoov: boolean;
}

/**
 * Decides whether an indexed file enters the embedded-GPS extraction queue and
 * whether to cache its moov bytes for the worker.
 *
 * Invariant the wiring MUST keep: the QUEUE decision depends ONLY on the file's
 * GPS source hint (and whether it already has sidecar records), NEVER on moov
 * presence. MPEG-TS containers (Juscar) have no moov, so the indexer yields no
 * moov bytes for them; a refactor once gated the queue on `hasMoovBytes`, which
 * dropped every TS file from extraction and left those trips with no GPS at all.
 * Moov caching is a separate, optional read-saving step.
 *
 * @param file - the video file (drives the GPS source-hint classification)
 * @param hasExistingRecords - true if a log/sidecar already produced GPS for it
 *        (then embedded extraction is redundant and skipped)
 * @param hasMoovBytes - true if the indexer returned cacheable moov bytes
 *        (MP4/MOV with a valid moov); false for MPEG-TS and moov-less files
 */
export function planEmbeddedGpsQueue(
    file: VendorFile,
    hasExistingRecords: boolean,
    hasMoovBytes: boolean,
): EmbeddedGpsQueuePlan {
    const queue = shouldTryEmbeddedGps(file, hasExistingRecords);
    return { queue, cacheMoov: queue && hasMoovBytes };
}

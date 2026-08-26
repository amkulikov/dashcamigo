// Contracts for the persistent-folder feature: remembered folder handles, the
// versioned index cache and user annotations. Everything here is stored in
// IndexedDB (db.ts) and must stay structured-cloneable: no live File objects.
// FileSystemHandle objects are the one exception - browsers clone them
// natively, which is the whole mechanism this feature stands on.

import type { IndexerRepair } from "../indexer.js";
import type { VideoCandidate } from "../trips.js";

/**
 * Bumped by hand whenever indexing/parsing semantics change in a way that
 * makes cached results stale (new extractor, changed classification, fixed
 * timestamp derivation, ...). A mismatch invalidates the whole cache and the
 * folder is re-indexed in full on next open. Deliberately one global version:
 * per-extractor granularity would need a dependency matrix (classify + source
 * hints + extractors + sidecars) that is easy to get wrong, and a silently
 * stale cache is worse than one extra re-index.
 */
export const INDEX_CACHE_VERSION = 20;

/**
 * Cheap cross-session identity of a file inside a picked folder, matchable
 * from directory enumeration alone (no byte reads). No content hash on
 * purpose: dashcams loop-record onto reused filenames, and (size,
 * lastModified) catches an overwrite at the same path. Mirrors the in-session
 * This intentionally omits vendorFileKey's session-only source scope so the
 * same remembered folder can reuse entries after a reload.
 */
export interface FileIdentity {
    /** Path relative to the remembered folder root, filename included. */
    relativePath: string;
    size: number;
    lastModified: number;
}

/**
 * A folder the user explicitly asked to remember. The handle is the live
 * FileSystemDirectoryHandle persisted via structured clone; permission on it
 * must be re-verified on every restore (queryPermission does NOT check that
 * the folder still exists - only an actual read does). An unavailable folder
 * (unplugged drive, revoked permission) stays in the list greyed out; it is
 * never auto-deleted.
 */
export interface RememberedFolder {
    id: string;
    handle: FileSystemDirectoryHandle;
    /** Display name, captured from handle.name at remember time. */
    label: string;
    addedAt: number;
    /** Orders the folder list and the landing chips, most recent first. */
    lastOpenedAt: number;
    /** Annotations sidecar file inside (or near) the folder; absent until the
     *  user completes the one-time save-picker flow. */
    sidecarHandle?: FileSystemFileHandle;
}

/**
 * Everything a VideoCandidate carries except the live File - the cacheable
 * remainder. Derived with Omit so a field added to VideoCandidate flows into
 * the cache automatically; whether its SEMANTICS require an
 * INDEX_CACHE_VERSION bump stays a review-time decision.
 */
export type CachedCandidateFields = Omit<VideoCandidate, "file" | "sourceKey">;

/** One cached indexing result, keyed by the file identity. */
export interface CachedFileIndex {
    /** fileIdentityKey() of the source file. */
    identityKey: string;
    /** INDEX_CACHE_VERSION at write time; a mismatch means reindex. */
    version: number;
    /** Last write OR last cache hit (refreshed on use, so the prune evicts
     *  what is not being opened, not what was merely written first). */
    savedAt: number;
    /** Approximate stored size (see approxEntryBytes) - the unit of the
     *  volume-based prune. Absent on entries written before it existed;
     *  those are evicted first when the prune runs. */
    bytes?: number;
    /** Identity of every parsed log/GPS/accel sidecar present with the video. */
    dependencyKey: string;
    candidate: CachedCandidateFields;
    /**
     * Container-repair descriptor when the indexer patched this file's moov.
     * The on-disk bytes stay broken forever, so the repair re-applies on every
     * restore; without it the cached candidate would point at a file whose
     * codec config the candidate metadata no longer matches.
     */
    repair?: IndexerRepair;
}

/**
 * Anchor for trip-level annotations. Trips are derived entities - regrouping
 * (parser version bump, trip-gap setting) rebuilds them - so annotations
 * anchor to the identity of the trip's first video file plus its start time,
 * and re-attach to whichever trip contains that file after a restore.
 */
export interface TripAnchor {
    /** fileIdentityKey() of the trip's first video file. */
    fileIdentityKey: string;
    /** Trip start, epoch ms UTC. */
    startUtc: number;
}

interface AnnotationBase {
    id: string;
    /** RememberedFolder.id the annotation belongs to. */
    folderId: string;
    /** Last-write-wins merge key across IndexedDB and the sidecar copy. */
    updatedAt: number;
    /** Tombstone: deletions must survive merging with an older copy, so a
     *  deleted annotation keeps its record with this flag instead of being
     *  removed from the store. */
    deleted: boolean;
}

/** User-editable trip metadata: custom name, free-text note, favorite flag. */
export interface TripMetaAnnotation extends AnnotationBase {
    kind: "tripMeta";
    anchor: TripAnchor;
    name?: string;
    note?: string;
    isFavorite?: boolean;
}

/** A point on the timeline: pure UTC anchor + short text, click-to-seek. */
export interface MarkerAnnotation extends AnnotationBase {
    kind: "marker";
    utc: number;
    text: string;
}

export type AnnotationRecord = TripMetaAnnotation | MarkerAnnotation;

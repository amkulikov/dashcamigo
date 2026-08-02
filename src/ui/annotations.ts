// Session layer over the annotation store: loads records into memory, anchors
// trip metadata to FILE identity (trips are derived entities - a parser bump
// or gap-setting change regroups them, so the anchor file, not the Trip
// object, is the stable thing), and persists edits fire-and-forget. Store
// unavailability degrades to session-only annotations, never an error.

import { createLogger } from "../log.js";
import { annotationContentEqual, loadAllAnnotations, saveAnnotation, saveAnnotations } from "../persist/annotations.js";
import { fileIdentityKey } from "../persist/identity.js";
import type { AnnotationRecord, MarkerAnnotation, TripMetaAnnotation } from "../persist/types.js";
import type { Trip, VideoCandidate } from "../trips.js";
import { tripAllCandidates } from "../trips.js";
import { folderIdForFileKey } from "./persistent-folders.js";
import { state } from "./state.js";

const log = createLogger("annotations");

// id -> record, tombstones included (an edit after a delete must LWW-win).
const recordsById = new Map<string, AnnotationRecord>();
// anchor file identity -> LIVE trip-meta record (tombstones excluded).
const tripMetaByAnchor = new Map<string, TripMetaAnnotation>();
// id -> LIVE timeline marker (tombstones excluded).
const markersById = new Map<string, MarkerAnnotation>();

/** Loads the stored annotations into the in-memory index. Call once at app
 *  start; until it resolves, lookups just return nothing. `onLoaded` fires
 *  when the load actually added records - the caller re-renders surfaces
 *  that may have painted before the store answered. */
export function initAnnotations(onLoaded?: () => void): void {
    void loadAllAnnotations()
        .then((records) => {
            let applied = 0;
            for (const record of records) {
                // A sidecar merge can land before this load resolves (chip
                // click on a cold start) - the older DB snapshot must not
                // override what the merge just wrote.
                const existing = recordsById.get(record.id);
                if (existing && existing.updatedAt >= record.updatedAt) continue;
                indexRecord(record);
                applied++;
            }
            if (applied > 0) {
                log.info("annotations loaded", { count: applied });
                onLoaded?.();
            }
        })
        .catch((err: unknown) => {
            log.warn("annotation store unavailable, session-only annotations", {
                err: err instanceof Error ? err.message : String(err),
            });
        });
}

function indexRecord(record: AnnotationRecord): void {
    recordsById.set(record.id, record);
    if (record.kind === "tripMeta") {
        // The anchor entry is shared across record ids (two profiles can
        // annotate the same trip independently), so both directions compare
        // updatedAt: a stale tombstone must not unindex a different, newer
        // live record, and of two live records the newer one wins
        // deterministically instead of by iteration order.
        const current = tripMetaByAnchor.get(record.anchor.fileIdentityKey);
        if (record.deleted) {
            if (current && (current.id === record.id || current.updatedAt <= record.updatedAt)) {
                tripMetaByAnchor.delete(record.anchor.fileIdentityKey);
            }
        } else if (!current || current.id === record.id || current.updatedAt <= record.updatedAt) {
            tripMetaByAnchor.set(record.anchor.fileIdentityKey, record);
        }
    } else if (record.kind === "marker") {
        if (record.deleted) markersById.delete(record.id);
        else markersById.set(record.id, record);
    }
}

function candidateIdentityKey(candidate: VideoCandidate): string {
    return fileIdentityKey({
        relativePath: candidate.relativePath,
        size: candidate.file.size,
        lastModified: candidate.file.lastModified,
    });
}

/**
 * The trip's metadata annotation, or null. Matched by containment: the record
 * anchors to one file, and whichever trip holds that file after the current
 * grouping owns the annotation.
 */
export function tripMetaFor(trip: Trip): TripMetaAnnotation | null {
    // No annotations at all (the common case) - skip the candidate walk;
    // this runs per card on the render path, including mid-ingest repaints.
    if (tripMetaByAnchor.size === 0) return null;
    for (const candidate of tripAllCandidates(trip)) {
        const meta = tripMetaByAnchor.get(candidateIdentityKey(candidate));
        if (meta) return meta;
    }
    return null;
}

/** User-editable subset of a trip-meta annotation. */
export interface TripMetaPatch {
    name?: string;
    note?: string;
    isFavorite?: boolean;
}

/**
 * Applies a patch to the trip's metadata annotation, creating it (anchored to
 * the trip's first file) when absent. A record whose fields all end up empty
 * turns into a tombstone - clearing the last field must not leave a ghost.
 * Persisted fire-and-forget; the in-memory index updates synchronously so the
 * caller can re-render immediately.
 */
export function setTripMeta(trip: Trip, patch: TripMetaPatch): void {
    const existing = tripMetaFor(trip);
    const firstCandidate = tripAllCandidates(trip)[0];
    if (!firstCandidate) return;
    const base: TripMetaAnnotation = existing
        ? { ...existing }
        : {
              id: crypto.randomUUID(),
              // "" when the trip's files did not come out of a remembered
              // folder (ad-hoc drop) - the annotation still works, it just
              // has no sidecar home.
              folderId: folderIdForFileKey(candidateIdentityKey(firstCandidate)),
              updatedAt: 0,
              deleted: false,
              kind: "tripMeta",
              anchor: {
                  fileIdentityKey: candidateIdentityKey(firstCandidate),
                  startUtc: Math.round(trip.startUtc * 1000),
              },
          };
    if (patch.name !== undefined) setOrDrop(base, "name", patch.name.trim());
    if (patch.note !== undefined) setOrDrop(base, "note", patch.note.trim());
    if (patch.isFavorite !== undefined) {
        if (patch.isFavorite) base.isFavorite = true;
        else delete base.isFavorite;
    }
    base.updatedAt = Date.now();
    base.deleted = !base.name && !base.note && base.isFavorite !== true;
    // A tombstone must be findable by id for LWW, but not by anchor.
    if (base.deleted) tripMetaByAnchor.delete(base.anchor.fileIdentityKey);
    persistRecord(base);
}

/** Sets a string field, or removes it when empty - the stored record then
 *  reads the same as "never set" (drives the tombstone check above). */
function setOrDrop(record: TripMetaAnnotation, field: "name" | "note", value: string): void {
    if (value) record[field] = value;
    else delete record[field];
}

/** Live markers whose UTC lands inside the trip's wall span, oldest first.
 *  Markers anchor to pure UTC, so regrouping cannot orphan them - they follow
 *  whatever trip covers that moment now. */
export function markersForTrip(trip: Trip): MarkerAnnotation[] {
    const startMs = trip.startUtc * 1000;
    const endMs = trip.endUtc * 1000;
    return [...markersById.values()].filter((m) => m.utc >= startMs && m.utc <= endMs).sort((a, b) => a.utc - b.utc);
}

/** A marker by id, or null (deleted/unknown). */
export function markerById(id: string): MarkerAnnotation | null {
    return markersById.get(id) ?? null;
}

/** Creates a marker at the given UTC (epoch ms) inside the trip. */
export function addMarker(trip: Trip, utcMs: number, text: string): MarkerAnnotation {
    const firstCandidate = tripAllCandidates(trip)[0];
    const record: MarkerAnnotation = {
        id: crypto.randomUUID(),
        folderId: firstCandidate ? folderIdForFileKey(candidateIdentityKey(firstCandidate)) : "",
        updatedAt: Date.now(),
        deleted: false,
        kind: "marker",
        utc: Math.round(utcMs),
        text: text.trim(),
    };
    persistRecord(record);
    return record;
}

/** Replaces a marker's text. No-op for a deleted/unknown id. */
export function updateMarkerText(id: string, text: string): void {
    const marker = markersById.get(id);
    if (!marker) return;
    persistRecord({ ...marker, text: text.trim(), updatedAt: Date.now() });
}

/** Tombstones a marker - the record survives for merge, the pin disappears. */
export function deleteMarker(id: string): void {
    const marker = markersById.get(id);
    if (!marker) return;
    persistRecord({ ...marker, deleted: true, updatedAt: Date.now() });
}

function persistRecord(record: AnnotationRecord): void {
    indexRecord(record);
    void saveAnnotation(record).catch((err: unknown) => {
        log.warn("annotation save failed", { err: err instanceof Error ? err.message : String(err) });
    });
    annotationsChangedHook?.(record.folderId);
}

// The sidecar layer (annotations-sidecar.ts) hangs off this hook - a direct
// import here would cycle (it reads records back through this module).
let annotationsChangedHook: ((folderId: string) => void) | null = null;

/** Registers the after-change hook (called with the record's folderId). */
export function registerAnnotationsChangedHook(callback: (folderId: string) => void): void {
    annotationsChangedHook = callback;
}

/** Every record of a folder, tombstones included - the sidecar file must
 *  carry deletions or they resurrect from an older copy on merge. */
export function recordsForFolder(folderId: string): AnnotationRecord[] {
    return [...recordsById.values()].filter((record) => record.folderId === folderId);
}

/**
 * Applies externally merged records (sidecar import): re-indexes them in
 * memory and batch-saves to IndexedDB. Returns how many records changed
 * user-visibly relative to the in-memory state (0 = nothing new, skip
 * re-render). A record whose only difference is folderId adopts the incoming
 * id silently: folderId is per-profile bookkeeping (restamped by the sidecar
 * reader), and without adoption a record imported on another machine - or
 * kept through a forget/re-remember cycle - would stay keyed to a dead id
 * and vanish from every future sidecar write.
 */
export function applyMergedRecords(records: AnnotationRecord[]): number {
    let changed = 0;
    const toSave: AnnotationRecord[] = [];
    for (const record of records) {
        const existing = recordsById.get(record.id);
        if (existing) {
            const localWins =
                existing.updatedAt > record.updatedAt ||
                (existing.updatedAt === record.updatedAt && annotationContentEqual(existing, record));
            if (localWins) {
                if (existing.folderId !== record.folderId) {
                    const restamped = { ...existing, folderId: record.folderId };
                    indexRecord(restamped);
                    toSave.push(restamped);
                }
                continue;
            }
        }
        indexRecord(record);
        toSave.push(record);
        changed++;
    }
    if (toSave.length > 0) {
        void saveAnnotations(toSave).catch((err: unknown) => {
            log.warn("merged annotation save failed", { err: err instanceof Error ? err.message : String(err) });
        });
    }
    return changed;
}

/**
 * Re-keys records onto `folderId` when they clearly belong to that folder
 * but are stranded on "" (created before the folder was remembered) or on a
 * dead id (the folder was forgotten and re-remembered under a fresh UUID).
 * Records owned by another still-existing folder are left alone. Trip
 * metadata re-associates by its anchor file; a marker has only a UTC, so an
 * orphaned one is adopted when it falls inside a trip made of this folder's
 * files. Returns how many records moved.
 */
export function rebindFolderAnnotations(folderId: string, existingFolderIds: ReadonlySet<string>): number {
    const ownedUtcRanges: Array<[number, number]> = [];
    for (const trip of state.trips) {
        const first = tripAllCandidates(trip)[0];
        if (first && folderIdForFileKey(candidateIdentityKey(first)) === folderId) {
            ownedUtcRanges.push([trip.startUtc * 1000, trip.endUtc * 1000]);
        }
    }
    let rebound = 0;
    for (const record of [...recordsById.values()]) {
        if (record.folderId === folderId) continue;
        if (record.folderId !== "" && existingFolderIds.has(record.folderId)) continue;
        let belongs = false;
        if (record.kind === "tripMeta") {
            belongs = folderIdForFileKey(record.anchor.fileIdentityKey) === folderId;
        } else if (record.kind === "marker") {
            belongs = ownedUtcRanges.some(([startMs, endMs]) => record.utc >= startMs && record.utc <= endMs);
        }
        if (!belongs) continue;
        // updatedAt stays: re-keying is not a content edit and must not win
        // LWW against a real edit made elsewhere.
        persistRecord({ ...record, folderId });
        rebound++;
    }
    return rebound;
}

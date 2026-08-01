// Session layer over the annotation store: loads records into memory, anchors
// trip metadata to FILE identity (trips are derived entities - a parser bump
// or gap-setting change regroups them, so the anchor file, not the Trip
// object, is the stable thing), and persists edits fire-and-forget. Store
// unavailability degrades to session-only annotations, never an error.

import { createLogger } from "../log.js";
import { loadAllAnnotations, saveAnnotation, saveAnnotations } from "../persist/annotations.js";
import { fileIdentityKey } from "../persist/identity.js";
import type { AnnotationRecord, MarkerAnnotation, TripMetaAnnotation } from "../persist/types.js";
import type { Trip, VideoCandidate } from "../trips.js";
import { tripAllCandidates } from "../trips.js";
import { folderIdForRootSegment } from "./persistent-folders.js";

const log = createLogger("annotations");

// id -> record, tombstones included (an edit after a delete must LWW-win).
const recordsById = new Map<string, AnnotationRecord>();
// anchor file identity -> LIVE trip-meta record (tombstones excluded).
const tripMetaByAnchor = new Map<string, TripMetaAnnotation>();
// id -> LIVE timeline marker (tombstones excluded).
const markersById = new Map<string, MarkerAnnotation>();

/** Loads the stored annotations into the in-memory index. Call once at app
 *  start; until it resolves, lookups just return nothing. */
export function initAnnotations(): void {
    void loadAllAnnotations()
        .then((records) => {
            for (const record of records) indexRecord(record);
            if (records.length > 0) log.info("annotations loaded", { count: records.length });
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
        if (record.deleted) tripMetaByAnchor.delete(record.anchor.fileIdentityKey);
        else tripMetaByAnchor.set(record.anchor.fileIdentityKey, record);
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
              // "" when the trip's root folder is not a remembered one (ad-hoc
              // drop) - the annotation still works, it just has no sidecar home.
              folderId: folderIdForRootSegment(rootSegment(firstCandidate.relativePath)),
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

function rootSegment(relativePath: string): string {
    const slash = relativePath.indexOf("/");
    return slash >= 0 ? relativePath.slice(0, slash) : "";
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
        folderId: firstCandidate ? folderIdForRootSegment(rootSegment(firstCandidate.relativePath)) : "",
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
 * relative to the in-memory state (0 = nothing new, skip re-render).
 */
export function applyMergedRecords(records: AnnotationRecord[]): number {
    let changed = 0;
    const toSave: AnnotationRecord[] = [];
    for (const record of records) {
        const existing = recordsById.get(record.id);
        if (existing && existing.updatedAt >= record.updatedAt) continue;
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

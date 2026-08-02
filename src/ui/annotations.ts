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
import { contentToWallUtc, isHydrationPending, tripAllCandidates, wallToContentSec } from "../trips.js";
import { folderIdForFileKey } from "./folder-sources.js";
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
    captureProvisionalAnchor(trip, record, utcMs);
    persistRecord(record);
    return record;
}

// === Re-stamping markers placed on a provisional timeline (lazy ingest) ===
//
// A marker is pure UTC, computed from the trip's startUtc - which, on the lazy
// path, is a filename-derived guess until hydration reads the real
// mvhd/GPS (a Skip in the hydration modal starts playback exactly there). The
// re-derive then moves the trip out from under the marker: the stored UTC
// lands at the wrong moment, on the wrong trip, or outside every trip, and
// the broken value flows into the notes file. So a marker placed while its
// trip still has pending candidates also records a SESSION anchor - the clip
// file at the playhead plus the content offset into it - and once the real
// timeline lands, the UTC is recomputed from that anchor and re-saved.

interface ProvisionalMarkerAnchor {
    /** Identity key of the clip file the marker was placed in. */
    fileKey: string;
    /** Content seconds from that clip's segment start to the marker. */
    offsetSec: number;
}

// marker id -> anchor, only for markers created on a not-yet-hydrated trip.
const provisionalMarkerAnchors = new Map<string, ProvisionalMarkerAnchor>();

// Repaints the timeline pins after a re-stamp. Registered from app.ts -
// importing timeline-markers here would cycle (it imports this module).
let markersRestampedHook: (() => void) | null = null;

/** Registers the after-re-stamp repaint. */
export function registerMarkersRestampedHook(callback: () => void): void {
    markersRestampedHook = callback;
}

/** Records the clip-relative position of a marker placed on a trip that still
 *  has un-hydrated candidates - the input for the later re-stamp. */
function captureProvisionalAnchor(trip: Trip, record: MarkerAnnotation, utcMs: number): void {
    if (!tripAllCandidates(trip).some(isHydrationPending)) return;
    const contentSec = wallToContentSec(trip.timeline, utcMs / 1000);
    const segment = trip.timeline.segments.find(
        (seg) => contentSec >= seg.contentStart && contentSec <= seg.contentEnd,
    );
    if (!segment) return;
    const frame = trip.frames[segment.frameIndex];
    const candidate = frame ? Object.values(frame.channels).find((ch) => ch != null) : undefined;
    if (!candidate) return;
    provisionalMarkerAnchors.set(record.id, {
        fileKey: candidateIdentityKey(candidate),
        offsetSec: contentSec - segment.contentStart,
    });
}

/**
 * Recomputes the UTC of provisionally-placed markers from their clip anchors
 * against the CURRENT trip timelines, re-saving the ones that moved. Call
 * after a lazy re-derive has rebuilt the affected trips. An anchor whose clip
 * is terminal (hydrated or read-failed) is done and dropped; one whose clip is
 * still pending stays for the next pass; one whose clip left the session is
 * dropped as unfixable. Returns how many markers moved.
 */
export function restampProvisionalMarkers(): number {
    if (provisionalMarkerAnchors.size === 0) return 0;
    let moved = 0;
    for (const [markerId, anchor] of [...provisionalMarkerAnchors]) {
        const marker = markersById.get(markerId);
        if (!marker) {
            // Deleted meanwhile - the tombstone's UTC does not matter.
            provisionalMarkerAnchors.delete(markerId);
            continue;
        }
        const located = locateCandidate(anchor.fileKey);
        if (!located) {
            provisionalMarkerAnchors.delete(markerId);
            continue;
        }
        if (isHydrationPending(located.candidate)) continue;
        const segment = located.trip.timeline.segments.find((seg) => seg.frameIndex === located.frameIndex);
        provisionalMarkerAnchors.delete(markerId);
        if (!segment) continue;
        const contentSec = Math.min(segment.contentStart + anchor.offsetSec, segment.contentEnd);
        const utcMs = Math.round(contentToWallUtc(located.trip.timeline, contentSec) * 1000);
        // Sub-half-second drift is invisible on the timeline - not worth a
        // store write and a notes-file flush.
        if (Math.abs(utcMs - marker.utc) < 500) continue;
        // A fresh updatedAt: the corrected UTC must LWW-win over the wrong
        // value that may already sit in the notes file or on another machine.
        persistRecord({ ...marker, utc: utcMs, updatedAt: Date.now() });
        moved++;
    }
    if (moved > 0) markersRestampedHook?.();
    return moved;
}

/** Clears the in-memory indexes and provisional anchors between unit tests. */
export function _resetForTests(): void {
    recordsById.clear();
    tripMetaByAnchor.clear();
    markersById.clear();
    provisionalMarkerAnchors.clear();
}

/** The trip and frame currently holding the clip with this identity key. */
function locateCandidate(fileKey: string): { trip: Trip; frameIndex: number; candidate: VideoCandidate } | null {
    for (const trip of state.trips) {
        for (let frameIndex = 0; frameIndex < trip.frames.length; frameIndex++) {
            const frame = trip.frames[frameIndex]!;
            for (const candidate of Object.values(frame.channels)) {
                if (candidate && candidateIdentityKey(candidate) === fileKey) {
                    return { trip, frameIndex, candidate };
                }
            }
        }
    }
    return null;
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

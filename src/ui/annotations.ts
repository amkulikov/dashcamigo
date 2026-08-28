// Session layer over the annotation store: loads records into memory, anchors
// trip metadata to FILE identity (trips are derived entities - a parser bump
// or gap-setting change regroups them, so the anchor file, not the Trip
// object, is the stable thing), and persists edits fire-and-forget. Store
// unavailability degrades to session-only annotations, never an error.

import { createLogger } from "../log.js";
import {
    compareAnnotationVersions,
    loadAllAnnotations,
    saveAnnotation,
    saveAnnotations,
} from "../persist/annotations.js";
import { fileIdentityKey } from "../persist/identity.js";
import type { AnnotationRecord, MarkerAnnotation, TripMetaAnnotation } from "../persist/types.js";
import type { Trip, VideoCandidate } from "../trips.js";
import { contentToWallUtc, needsRecordingMetadata, tripAllCandidates, wallToContentSec } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";
import { folderIdForFileKey } from "./folder-sources.js";
import { state } from "./state.js";

const log = createLogger("annotations");

// id -> record, tombstones included (an edit after a delete must LWW-win).
const recordsById = new Map<string, AnnotationRecord>();
// anchor file identity -> LIVE trip-meta record (tombstones excluded).
const tripMetaByAnchor = new Map<string, TripMetaAnnotation>();
// anchor file identity -> winning trip-meta version, tombstones included. A
// tombstone leaves no trace in tripMetaByAnchor, so this separate winner keeps
// an older live record from resurrecting it. Keeping the full record (not just
// updatedAt) also makes exact timestamp ties deterministic across load orders.
const tripMetaWinnerByAnchor = new Map<string, TripMetaAnnotation>();
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
                if (existing && compareAnnotationVersions(existing, record) >= 0) continue;
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
        // annotate the same trip independently), so resolve against the full
        // winning version, never iteration order.
        const key = record.anchor.fileIdentityKey;
        const winner = tripMetaWinnerByAnchor.get(key);
        if (winner && compareTripMetaVersions(record, winner) < 0) return;
        tripMetaWinnerByAnchor.set(key, record);
        if (record.deleted) tripMetaByAnchor.delete(key);
        else tripMetaByAnchor.set(key, record);
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

function candidateClockPending(candidate: VideoCandidate): boolean {
    const key = vendorFileKey(candidate);
    return (
        needsRecordingMetadata(candidate) ||
        state.pendingHeavyEmbeddedGps.has(key) ||
        state.inflightEmbeddedGps.has(key)
    );
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
    // The NEWEST of them, not the first: a regroup can pull two separately
    // annotated trips into one, and picking by frame order would show whichever
    // clip happens to sort first - and hide an edit made after it.
    let best: TripMetaAnnotation | null = null;
    for (const candidate of tripAllCandidates(trip)) {
        const meta = tripMetaByAnchor.get(candidateIdentityKey(candidate));
        if (meta && (best === null || compareTripMetaVersions(meta, best) > 0)) best = meta;
    }
    return best;
}

/** Every live trip-meta record anchored inside this trip. More than one only
 *  after a regroup merged separately annotated trips. */
function liveTripMetas(trip: Trip): TripMetaAnnotation[] {
    if (tripMetaByAnchor.size === 0) return [];
    const out: TripMetaAnnotation[] = [];
    for (const candidate of tripAllCandidates(trip)) {
        const meta = tripMetaByAnchor.get(candidateIdentityKey(candidate));
        if (meta && !out.includes(meta)) out.push(meta);
    }
    return out;
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
    // Captured before the edit: any OTHER record anchored in this trip is a
    // leftover of a regroup that merged two annotated trips. Only the newest is
    // ever shown, so leaving one live means clearing the visible name uncovers
    // a name the user thought was gone. They are folded in ONLY when this edit
    // clears the trip (below) - trip membership is derived and reversible, so
    // tombstoning on an ordinary edit would destroy the other trip's name the
    // moment the gap setting puts the two back apart.
    const superseded = liveTripMetas(trip).filter((meta) => meta.id !== existing?.id);
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
    // Past the anchor winner, not just "now": another machine's fast clock
    // can leave a future-stamped record (a tombstone in particular) on this
    // anchor, and a wall-clock stamp behind it loses LWW - indexRecord would
    // drop this edit on the floor, and so would the other machine when the
    // notes file reaches it. The same-id escape hatch in indexRecord does not
    // help here: clearing an anchor leaves no `current` for a new record to
    // match. Bounded by the skew that already exists; it never invents more.
    base.updatedAt = Math.max(
        Date.now(),
        (tripMetaWinnerByAnchor.get(base.anchor.fileIdentityKey)?.updatedAt ?? 0) + 1,
    );
    base.deleted = !base.name && !base.note && base.isFavorite !== true;
    if (base.deleted) {
        // Tombstones need the anchor for merge/rebinding, but not the note the
        // user explicitly removed. Do not keep deleted private text forever in
        // IndexedDB and every future copy of the notes file.
        delete base.name;
        delete base.note;
        delete base.isFavorite;
    }
    persistRecord(base);
    // A clear is not a moment to talk about keeping annotations - only a
    // record the user wants to keep goes to the user-edit hook.
    if (!base.deleted) userAnnotationHook?.(base);
    // Clearing the card means "this trip has no annotation" - so the leftovers
    // it was hiding go with it, or the next render uncovers one of them.
    // Anything short of a clear leaves them alone: they still belong to the
    // trip they were written on, which a different gap setting brings back.
    if (base.deleted) {
        for (const meta of superseded) {
            persistRecord({
                id: meta.id,
                folderId: meta.folderId,
                updatedAt: base.updatedAt,
                deleted: true,
                kind: "tripMeta",
                anchor: meta.anchor,
            });
        }
    }
}

/** Sets a string field, or removes it when empty - the stored record then
 *  reads the same as "never set" (drives the tombstone check above). */
function setOrDrop(record: TripMetaAnnotation, field: "name" | "note", value: string): void {
    if (value) record[field] = value;
    else delete record[field];
}

/** Live markers whose UTC lands inside the trip's wall span, oldest first.
 *  Markers anchor to UTC plus folder ownership, so regrouping cannot orphan
 *  them without making a same-time trip from another folder claim them. */
export function markersForTrip(trip: Trip): MarkerAnnotation[] {
    const startMs = trip.startUtc * 1000;
    const endMs = trip.endUtc * 1000;
    const folderIds = folderIdsForTrip(trip);
    return [...markersById.values()]
        .filter((marker) => folderIds.has(marker.folderId) && marker.utc >= startMs && marker.utc <= endMs)
        .sort((a, b) => a.utc - b.utc);
}

function folderIdsForTrip(trip: Trip): Set<string> {
    return new Set(tripAllCandidates(trip).map((candidate) => folderIdForFileKey(candidateIdentityKey(candidate))));
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
    userAnnotationHook?.(record);
    return record;
}

// === Re-stamping markers placed on a provisional timeline ===
//
// A marker is pure UTC, computed from a trip start that may still rely on
// filename evidence. Metadata or GPS can refine that clock and move the trip
// out from under the marker: the stored UTC
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

// marker id -> anchor for markers created before all clock evidence is available.
const provisionalMarkerAnchors = new Map<string, ProvisionalMarkerAnchor>();

// Repaints the timeline pins after a re-stamp. Registered from app.ts -
// importing timeline-markers here would cycle (it imports this module).
let markersRestampedHook: (() => void) | null = null;

/** Registers the after-re-stamp repaint. */
export function registerMarkersRestampedHook(callback: () => void): void {
    markersRestampedHook = callback;
}

/** Records the clip-relative position of a marker placed on a trip whose
 * absolute clock can still be refined. */
function captureProvisionalAnchor(trip: Trip, record: MarkerAnnotation, utcMs: number): void {
    if (!tripAllCandidates(trip).some(candidateClockPending)) return;
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
 * after progressive clock refinement rebuilds affected trips, and once more with
 * `final` after the closing regroup sweep - that sweep reconciles trip
 * boundaries with the real durations and can shift startUtc again, so an
 * anchor consumed at per-trip metadata read would leave the marker on the
 * intermediate timeline. An anchor whose clip left the session is dropped as
 * unfixable; one whose clip still has pending metadata or telemetry waits for
 * the next pass. `final` releases every settled anchor. Returns how many moved.
 */
export function restampProvisionalMarkers(opts?: {
    final?: boolean;
    finalCandidates?: readonly VideoCandidate[];
}): number {
    if (provisionalMarkerAnchors.size === 0) return 0;
    // One index for the whole pass: anchors are held until the closing sweep,
    // so a per-anchor walk of every trip's every frame would repeat that scan
    // on each of the per-trip metadata read passes.
    const byIdentity = indexCandidatesByIdentity();
    const pending = new Set<string>();
    let moved = 0;
    for (const [markerId, anchor] of [...provisionalMarkerAnchors]) {
        const marker = markersById.get(markerId);
        if (!marker) {
            // Deleted meanwhile - the tombstone's UTC does not matter.
            provisionalMarkerAnchors.delete(markerId);
            continue;
        }
        const located = byIdentity.get(anchor.fileKey) ?? null;
        if (!located) {
            provisionalMarkerAnchors.delete(markerId);
            continue;
        }
        if (candidateClockPending(located.candidate)) {
            pending.add(markerId);
            continue;
        }
        const segment = located.trip.timeline.segments.find((seg) => seg.frameIndex === located.frameIndex);
        if (!segment) continue;
        const contentSec = Math.min(segment.contentStart + anchor.offsetSec, segment.contentEnd);
        const utcMs = Math.round(contentToWallUtc(located.trip.timeline, contentSec) * 1000);
        // Sub-half-second drift is invisible on the timeline - not worth a
        // store write and a notes-file flush.
        if (Math.abs(utcMs - marker.utc) < 500) continue;
        // A fresh updatedAt: the corrected UTC must LWW-win over the wrong
        // value that may already sit in the notes file or on another machine.
        persistRecord({ ...marker, utc: utcMs, updatedAt: nextUpdatedAt(marker) });
        moved++;
    }
    if (opts?.final) {
        const finalKeys = opts.finalCandidates
            ? new Set(opts.finalCandidates.map((candidate) => candidateIdentityKey(candidate)))
            : null;
        for (const [markerId, anchor] of provisionalMarkerAnchors) {
            if (!pending.has(markerId) && (!finalKeys || finalKeys.has(anchor.fileKey))) {
                provisionalMarkerAnchors.delete(markerId);
            }
        }
    }
    if (moved > 0) markersRestampedHook?.();
    return moved;
}

/** Clears the in-memory indexes and provisional anchors between unit tests. */
export function _resetForTests(): void {
    recordsById.clear();
    tripMetaByAnchor.clear();
    tripMetaWinnerByAnchor.clear();
    markersById.clear();
    provisionalMarkerAnchors.clear();
}

interface LocatedCandidate {
    trip: Trip;
    frameIndex: number;
    candidate: VideoCandidate;
}

/** Identity key -> the trip and frame currently holding that clip. */
function indexCandidatesByIdentity(): Map<string, LocatedCandidate> {
    const out = new Map<string, LocatedCandidate>();
    for (const trip of state.trips) {
        for (let frameIndex = 0; frameIndex < trip.frames.length; frameIndex++) {
            const frame = trip.frames[frameIndex]!;
            for (const candidate of Object.values(frame.channels)) {
                if (!candidate) continue;
                const key = candidateIdentityKey(candidate);
                if (!out.has(key)) out.set(key, { trip, frameIndex, candidate });
            }
        }
    }
    return out;
}

/** Replaces a marker's text. No-op for a deleted/unknown id. */
export function updateMarkerText(id: string, text: string): void {
    const marker = markersById.get(id);
    if (!marker) return;
    const updated = { ...marker, text: text.trim(), updatedAt: nextUpdatedAt(marker) };
    persistRecord(updated);
    userAnnotationHook?.(updated);
}

/** Tombstones a marker - the record survives for merge, the pin disappears. */
export function deleteMarker(id: string): void {
    const marker = markersById.get(id);
    if (!marker) return;
    persistRecord({ ...marker, text: "", deleted: true, updatedAt: nextUpdatedAt(marker) });
}

function nextUpdatedAt(record: AnnotationRecord): number {
    return Math.max(Date.now(), record.updatedAt + 1);
}

function compareTripMetaVersions(a: TripMetaAnnotation, b: TripMetaAnnotation): number {
    const contentOrder = compareAnnotationVersions(a, b);
    if (contentOrder !== 0 || a.id === b.id) return contentOrder;
    return a.id > b.id ? 1 : -1;
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

// Fired ONLY by the user-invoked edit paths (setTripMeta, addMarker,
// updateMarkerText) - never by re-keying, re-stamping or merge bookkeeping,
// which replay records the user wrote some other time. The notes-file nudge
// hangs off this: it must mean "the user just wrote something they care
// about", or it fires on a folder open. Registered hook, not an import - the
// nudge lives in the UI layer above this module.
let userAnnotationHook: ((record: AnnotationRecord) => void) | null = null;

/** Registers the after-user-edit hook. */
export function registerUserAnnotationHook(callback: (record: AnnotationRecord) => void): void {
    userAnnotationHook = callback;
}

/** RememberedFolder id this trip's next annotation would resolve to: the id
 *  already carried by its live annotation, else the id of the remembered
 *  folder its first file came out of, else "". */
export function tripFolderId(trip: Trip): string {
    const existing = tripMetaFor(trip);
    if (existing?.folderId) return existing.folderId;
    const anchorKey = tripAnchorFileIdentityKey(trip);
    return anchorKey ? folderIdForFileKey(anchorKey) : "";
}

/** Identity used to anchor this trip's metadata, and to resolve its live
 *  source before that source has been remembered. */
export function tripAnchorFileIdentityKey(trip: Trip): string | null {
    const first = tripAllCandidates(trip)[0];
    return first ? candidateIdentityKey(first) : null;
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
 * and vanish from every future sidecar write. A handle-less batch can pass
 * preserveFolderIds to keep bindings that still refer to remembered folders;
 * dead bindings remain adoptable.
 */
export function applyMergedRecords(
    records: AnnotationRecord[],
    options?: { preserveFolderIds?: ReadonlySet<string> },
): number {
    let changed = 0;
    const toSave: AnnotationRecord[] = [];
    for (const record of records) {
        const existing = recordsById.get(record.id);
        const preserveFolder = existing && options?.preserveFolderIds?.has(existing.folderId);
        const incoming = preserveFolder ? { ...record, folderId: existing.folderId } : record;
        if (existing) {
            const localWins = compareAnnotationVersions(existing, incoming) >= 0;
            if (localWins) {
                if (!preserveFolder && existing.folderId !== incoming.folderId) {
                    const restamped = { ...existing, folderId: incoming.folderId };
                    indexRecord(restamped);
                    toSave.push(restamped);
                }
                continue;
            }
        }
        indexRecord(incoming);
        toSave.push(incoming);
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
        if (folderIdsForTrip(trip).has(folderId)) {
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

// Annotation store operations + the pure last-write-wins merge. UI-free; the
// session layer (ui/annotations.ts) owns attachment to trips and rendering.

import { openPersistDb } from "./db.js";
import type { AnnotationRecord } from "./types.js";

/** All stored annotations, tombstones included - merging needs them. */
export async function loadAllAnnotations(): Promise<AnnotationRecord[]> {
    const db = await openPersistDb();
    return db.getAll("annotations");
}

/** Upserts one annotation (tombstones are saved like live records). */
export async function saveAnnotation(record: AnnotationRecord): Promise<void> {
    const db = await openPersistDb();
    await db.put("annotations", record);
}

/** Batch upsert in one transaction - the sidecar merge writes dozens at once. */
export async function saveAnnotations(records: AnnotationRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await openPersistDb();
    const tx = db.transaction("annotations", "readwrite");
    for (const record of records) {
        // Voided, but with its own catch: an aborted transaction rejects every
        // pending request, and a bare `void` would surface each one as an
        // unhandled rejection. tx.done below carries the real failure.
        void tx.store.put(record).catch(() => {});
    }
    await tx.done;
}

/**
 * Compares two versions of the same annotation. A newer timestamp wins; an
 * exact tie prefers a tombstone, then a stable content key. The final tie-break
 * matters when two profiles edit the same record inside the same millisecond:
 * both merge directions must pick the same value or the shared file oscillates
 * between them forever. folderId is intentionally absent from the key because
 * it is local profile bookkeeping, not shared content.
 */
export function compareAnnotationVersions(a: AnnotationRecord, b: AnnotationRecord): number {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
    const aKey = annotationContentKey(a);
    const bKey = annotationContentKey(b);
    if (aKey === bKey) return 0;
    return aKey > bKey ? 1 : -1;
}

function annotationContentKey(record: AnnotationRecord): string {
    if (record.kind === "tripMeta") {
        return JSON.stringify([
            record.kind,
            record.anchor.fileIdentityKey,
            record.anchor.startUtc,
            record.name ?? null,
            record.note ?? null,
            record.isFavorite ?? null,
        ]);
    }
    return JSON.stringify([
        record.kind,
        record.utc,
        record.text,
        record.anchor?.fileIdentityKey ?? null,
        record.anchor?.startUtc ?? null,
        record.anchor?.offsetSec ?? null,
    ]);
}

/**
 * Merges two annotation sets per record using compareAnnotationVersions.
 * Pure; result order is unspecified.
 */
export function mergeAnnotationLists(a: AnnotationRecord[], b: AnnotationRecord[]): AnnotationRecord[] {
    const byId = new Map<string, AnnotationRecord>();
    for (const records of [a, b]) {
        for (const record of records) {
            const prev = byId.get(record.id);
            if (!prev || compareAnnotationVersions(record, prev) > 0) byId.set(record.id, record);
        }
    }
    return [...byId.values()];
}

/** Wire format marker of the notes file. Read by parseSidecarPayload, written
 *  by buildSidecarPayload - the two must agree, which is why they live here. */
const SIDECAR_FORMAT = "annotations";

/**
 * The exact object written into a folder's notes file. `savedAt` is a human
 * courtesy (nothing reads it back); the records travel as-is, folderId
 * included, and the reader restamps it with its own local id.
 */
export function buildSidecarPayload(records: AnnotationRecord[], savedAt: number): object {
    return { app: "dashcamigo", format: SIDECAR_FORMAT, version: 1, savedAt, annotations: records };
}

function isSafeTimestamp(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    return Object.keys(value).every((key) => allowed.has(key));
}

const TRIP_META_KEYS = new Set([
    "id",
    "folderId",
    "updatedAt",
    "deleted",
    "kind",
    "anchor",
    "name",
    "note",
    "isFavorite",
]);
const TRIP_ANCHOR_KEYS = new Set(["fileIdentityKey", "startUtc"]);
const MARKER_KEYS = new Set(["id", "folderId", "updatedAt", "deleted", "kind", "utc", "text", "anchor"]);
const MARKER_ANCHOR_KEYS = new Set(["fileIdentityKey", "startUtc", "offsetSec"]);
const SIDECAR_KEYS = new Set(["app", "format", "version", "savedAt", "annotations"]);

export interface SidecarParseResult {
    records: AnnotationRecord[];
    /** Entries that could not be understood. A reader may recover the valid
     * records, but a writer must not replace the file and erase these entries. */
    rejectedEntries: number;
}

/**
 * Parses compatible v1 notes JSON, or null when the whole file is foreign,
 * corrupt, or from an unsupported format version. Validation stays per entry
 * so readable records can still be recovered, while rejectedEntries makes
 * that recovery explicitly read-only. folderId is not trusted; callers
 * restamp it with their local folder id.
 */
export function parseSidecarPayload(text: string): SidecarParseResult | null {
    if (text.trim() === "") return { records: [], rejectedEntries: 0 };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (
        obj.app !== "dashcamigo" ||
        obj.format !== SIDECAR_FORMAT ||
        obj.version !== 1 ||
        !Array.isArray(obj.annotations)
    ) {
        return null;
    }
    const out: AnnotationRecord[] = [];
    let rejectedEntries = hasOnlyKeys(obj, SIDECAR_KEYS) ? 0 : 1;
    if (obj.savedAt !== undefined && !isSafeTimestamp(obj.savedAt)) rejectedEntries++;
    for (const entry of obj.annotations) {
        if (typeof entry !== "object" || entry === null) {
            rejectedEntries++;
            continue;
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== "string" || record.id === "") {
            rejectedEntries++;
            continue;
        }
        if (!isSafeTimestamp(record.updatedAt)) {
            rejectedEntries++;
            continue;
        }
        if (typeof record.deleted !== "boolean") {
            rejectedEntries++;
            continue;
        }
        if (record.kind === "tripMeta") {
            const anchor = record.anchor as Record<string, unknown> | null | undefined;
            if (typeof anchor !== "object" || anchor === null) {
                rejectedEntries++;
                continue;
            }
            if (typeof anchor.fileIdentityKey !== "string" || !isSafeTimestamp(anchor.startUtc)) {
                rejectedEntries++;
                continue;
            }
            if (!isOptionalString(record.name) || !isOptionalString(record.note)) {
                rejectedEntries++;
                continue;
            }
            if (record.isFavorite !== undefined && typeof record.isFavorite !== "boolean") {
                rejectedEntries++;
                continue;
            }
            out.push({
                id: record.id,
                folderId: typeof record.folderId === "string" ? record.folderId : "",
                updatedAt: record.updatedAt,
                deleted: record.deleted,
                kind: "tripMeta",
                anchor: { fileIdentityKey: anchor.fileIdentityKey, startUtc: anchor.startUtc },
                ...(record.name !== undefined ? { name: record.name } : {}),
                ...(record.note !== undefined ? { note: record.note } : {}),
                ...(record.isFavorite !== undefined ? { isFavorite: record.isFavorite } : {}),
            });
            if (!hasOnlyKeys(record, TRIP_META_KEYS) || !hasOnlyKeys(anchor, TRIP_ANCHOR_KEYS)) rejectedEntries++;
        } else if (record.kind === "marker") {
            if (!isSafeTimestamp(record.utc) || typeof record.text !== "string") {
                rejectedEntries++;
                continue;
            }
            const anchor = record.anchor as Record<string, unknown> | null | undefined;
            if (
                anchor !== undefined &&
                (typeof anchor !== "object" ||
                    anchor === null ||
                    typeof anchor.fileIdentityKey !== "string" ||
                    !isSafeTimestamp(anchor.startUtc) ||
                    typeof anchor.offsetSec !== "number" ||
                    !Number.isFinite(anchor.offsetSec) ||
                    anchor.offsetSec < 0)
            ) {
                rejectedEntries++;
                continue;
            }
            out.push({
                id: record.id,
                folderId: typeof record.folderId === "string" ? record.folderId : "",
                updatedAt: record.updatedAt,
                deleted: record.deleted,
                kind: "marker",
                utc: record.utc,
                text: record.text,
                ...(anchor
                    ? {
                          anchor: {
                              fileIdentityKey: anchor.fileIdentityKey as string,
                              startUtc: anchor.startUtc as number,
                              offsetSec: anchor.offsetSec as number,
                          },
                      }
                    : {}),
            });
            if (!hasOnlyKeys(record, MARKER_KEYS) || (anchor && !hasOnlyKeys(anchor, MARKER_ANCHOR_KEYS))) {
                rejectedEntries++;
            }
        } else {
            rejectedEntries++;
        }
    }
    return { records: out, rejectedEntries };
}

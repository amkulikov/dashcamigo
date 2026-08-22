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
    return JSON.stringify([record.kind, record.utc, record.text]);
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

/**
 * Parses compatible v1 sidecar JSON into annotation records, or null when the
 * file is foreign, corrupt, or from an unsupported format version. Individual
 * malformed entries are skipped, never fatal - validation is per-kind and
 * strict, because a
 * record that passes lands in IndexedDB and in the render path: a tripMeta
 * without an anchor would throw at index time, an Infinity updatedAt would
 * pin itself against every future LWW edit, a non-string name would render
 * as "[object Object]". folderId is NOT validated or trusted - callers
 * restamp it with the local folder id.
 */
export function parseSidecarPayload(text: string): AnnotationRecord[] | null {
    if (text.trim() === "") return [];
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
    for (const entry of obj.annotations) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== "string" || record.id === "") continue;
        if (!isSafeTimestamp(record.updatedAt)) continue;
        if (typeof record.deleted !== "boolean") continue;
        if (record.kind === "tripMeta") {
            const anchor = record.anchor as Record<string, unknown> | null | undefined;
            if (typeof anchor !== "object" || anchor === null) continue;
            if (typeof anchor.fileIdentityKey !== "string" || !isSafeTimestamp(anchor.startUtc)) continue;
            if (!isOptionalString(record.name) || !isOptionalString(record.note)) continue;
            if (record.isFavorite !== undefined && typeof record.isFavorite !== "boolean") continue;
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
        } else if (record.kind === "marker") {
            if (!isSafeTimestamp(record.utc) || typeof record.text !== "string") continue;
            out.push({
                id: record.id,
                folderId: typeof record.folderId === "string" ? record.folderId : "",
                updatedAt: record.updatedAt,
                deleted: record.deleted,
                kind: "marker",
                utc: record.utc,
                text: record.text,
            });
        }
    }
    return out;
}

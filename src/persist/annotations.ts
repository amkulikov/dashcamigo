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
 * Merges two annotation sets per record: same id -> higher updatedAt wins; an
 * exact timestamp tie prefers the tombstone, so a deletion can never resurrect
 * on a clock tie. Pure; result order is unspecified.
 */
export function mergeAnnotationLists(a: AnnotationRecord[], b: AnnotationRecord[]): AnnotationRecord[] {
    const byId = new Map<string, AnnotationRecord>();
    for (const record of a) byId.set(record.id, record);
    for (const record of b) {
        const prev = byId.get(record.id);
        const wins =
            !prev ||
            record.updatedAt > prev.updatedAt ||
            (record.updatedAt === prev.updatedAt && record.deleted && !prev.deleted);
        if (wins) byId.set(record.id, record);
    }
    return [...byId.values()];
}

/**
 * Whether two records carry the same user-visible content and version.
 * folderId is deliberately ignored - it is per-profile bookkeeping, not
 * content, and differs across machines sharing one sidecar file.
 */
export function annotationContentEqual(a: AnnotationRecord, b: AnnotationRecord): boolean {
    if (a.kind !== b.kind || a.deleted !== b.deleted || a.updatedAt !== b.updatedAt) return false;
    if (a.kind === "tripMeta" && b.kind === "tripMeta") {
        return (
            a.anchor.fileIdentityKey === b.anchor.fileIdentityKey &&
            a.anchor.startUtc === b.anchor.startUtc &&
            a.name === b.name &&
            a.note === b.note &&
            a.isFavorite === b.isFavorite
        );
    }
    if (a.kind === "marker" && b.kind === "marker") {
        return a.utc === b.utc && a.text === b.text;
    }
    return false;
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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

/**
 * Parses sidecar-file JSON into annotation records, or null when the file is
 * not a dashcamigo annotations file at all. Individual malformed entries are
 * skipped, never fatal - and validation is per-kind and strict, because a
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
    if (obj.format !== SIDECAR_FORMAT || !Array.isArray(obj.annotations)) return null;
    const out: AnnotationRecord[] = [];
    for (const entry of obj.annotations) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== "string" || record.id === "") continue;
        if (!isFiniteNumber(record.updatedAt)) continue;
        if (typeof record.deleted !== "boolean") continue;
        if (record.kind === "tripMeta") {
            const anchor = record.anchor as Record<string, unknown> | null | undefined;
            if (typeof anchor !== "object" || anchor === null) continue;
            if (typeof anchor.fileIdentityKey !== "string" || !isFiniteNumber(anchor.startUtc)) continue;
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
            if (!isFiniteNumber(record.utc) || typeof record.text !== "string") continue;
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

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
        void tx.store.put(record);
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

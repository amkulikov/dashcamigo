import type { VendorFile } from "../parsers/types.js";
import type { IngestOrigin } from "./state.js";

let nextSourceId = 1;
let sourceKeyByHandle = new WeakMap<FileSystemDirectoryHandle, string>();

function sourceKeyFor(origin: IngestOrigin | null): string {
    if (origin?.folderId) return `folder:${origin.folderId}`;
    if (origin) {
        const existing = sourceKeyByHandle.get(origin.handle);
        if (existing) return existing;
        const key = `handle:${nextSourceId++}`;
        sourceKeyByHandle.set(origin.handle, key);
        return key;
    }
    return `drop:${nextSourceId++}`;
}

/**
 * Gives every file in one picker/drop batch a source scope. Queued batches
 * already carry their scope and pass through unchanged when dequeued.
 */
export function scopeIngestFiles(files: VendorFile[], origin: IngestOrigin | null): VendorFile[] {
    if (files.length === 0 || files.every((file) => file.sourceKey !== undefined)) return files;
    const sourceKey = sourceKeyFor(origin);
    return files.map((file) => (file.sourceKey === undefined ? { ...file, sourceKey } : file));
}

/** Clears module state between unit tests. */
export function _resetForTests(): void {
    nextSourceId = 1;
    sourceKeyByHandle = new WeakMap();
}

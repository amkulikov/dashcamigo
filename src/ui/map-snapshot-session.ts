import type { ExportMapSnapshotter, SnapshotRequest } from "./export-map-snapshot.js";

/** One map and compositor shared by serialized export requests. */
export class MapSnapshotSession {
    private snapshotter: Promise<ExportMapSnapshotter> | null = null;
    private tail: Promise<void> = Promise.resolve();
    private disposal: Promise<void> | null = null;
    private isDisposed = false;

    constructor(private create: () => Promise<ExportMapSnapshotter>) {}

    private ensure(): Promise<ExportMapSnapshotter> {
        if (this.isDisposed) throw new DOMException("map snapshot session disposed", "AbortError");
        this.snapshotter ??= this.create();
        return this.snapshotter;
    }

    async preload(): Promise<void> {
        await this.ensure();
    }

    snapshot(request: SnapshotRequest): Promise<ImageBitmap> {
        const result = this.tail.then(async () => {
            const snapshotter = await this.ensure();
            if (this.isDisposed) throw new DOMException("map snapshot session disposed", "AbortError");
            return snapshotter.snapshot(request);
        });
        this.tail = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    dispose(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.isDisposed = true;
        const pending = this.snapshotter;
        this.disposal = this.tail.then(async () => {
            if (!pending) return;
            // A cancelled initialization still owns its eventual WebGL context.
            const snapshotter = await pending.catch(() => null);
            snapshotter?.dispose();
        });
        return this.disposal;
    }
}

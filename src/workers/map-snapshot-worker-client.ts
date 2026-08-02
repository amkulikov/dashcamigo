// Worker-side implementation of MapSnapshotter. Forwards each snapshot
// request to the main thread via a notification + correlated reply.
//
// Why notifications instead of a proper request: the worker-server protocol
// flows main → worker for requests, and the snapshotter needs the opposite
// direction. Notifications are bidirectional in our wire layer, so we layer a
// lightweight reqId correlation on top.

import type { WorkerServer } from "./_protocol/worker-server.js";
import type { MapSnapshotter, MapSnapshotRequest } from "../transcode/map-snapshotter-types.js";
import {
    TRANSCODE_NOTIFY_MAP_SNAPSHOT_REQUEST,
    type MapSnapshotRequestNotification,
    type MapSnapshotResponseNotification,
} from "./transcode-protocol.js";

interface Pending {
    resolve: (bm: ImageBitmap) => void;
    reject: (err: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Hard timeout per snapshot request. The main thread *should* always reply
 * (try/catch in the shim turns any throw into an error response), but a
 * truly unresponsive page (OOM, blocking sync code) would otherwise leave
 * the worker hot loop awaiting forever. 30 s is generous - typical snapshot
 * is 5-80 ms; even a cold tile fetch is well under a second.
 */
const SNAPSHOT_TIMEOUT_MS = 30_000;

/**
 * Wider ceiling until the main thread has answered ONCE: up to that point every
 * in-flight request is queued behind MapLibre init + style load + the range
 * prewarm walk (itself capped by PREWARM_BUDGET_MS in export-map-snapshot.ts,
 * which this must comfortably exceed). Gated on the first RESPONSE, not on
 * reqId: the pipeline decodes one frame ahead, so request 2 is issued while
 * request 1 is still warming up and would start a 30 s timer it cannot beat.
 * One timeout latches the map off for the whole export, so nothing may race
 * legitimate warm-up work - only a truly dead main thread.
 */
const FIRST_SNAPSHOT_TIMEOUT_MS = 120_000;

export class MapSnapshotWorkerClient implements MapSnapshotter {
    private nextId = 1;
    private pending = new Map<number, Pending>();
    // Flips on the first reply of any kind: warm-up is over from then on.
    private warmedUp = false;

    constructor(private server: WorkerServer) {}

    /**
     * Called from the worker's onNotification handler whenever a
     * MAP_SNAPSHOT_RESPONSE arrives. Looks up the pending request by reqId
     * and resolves/rejects it. Late replies after dispose() are ignored.
     */
    onResponse(data: MapSnapshotResponseNotification): void {
        const entry = this.pending.get(data.reqId);
        if (!entry) {
            // Late reply (timeout already fired / dispose ran): the transferred
            // bitmap arrived with no consumer. Close it instead of leaving the
            // GPU surface to lazy GC - snapshots are ~1 MB of VRAM each.
            data.bitmap?.close();
            return;
        }
        this.pending.delete(data.reqId);
        this.warmedUp = true;
        clearTimeout(entry.timeoutId);
        if (data.error) {
            entry.reject(new Error(`map snapshot failed: ${data.error}`));
            return;
        }
        if (!data.bitmap) {
            entry.reject(new Error("map snapshot returned no bitmap"));
            return;
        }
        entry.resolve(data.bitmap);
    }

    snapshot(req: MapSnapshotRequest): Promise<ImageBitmap> {
        const reqId = this.nextId++;
        const timeoutMs = this.warmedUp ? SNAPSHOT_TIMEOUT_MS : FIRST_SNAPSHOT_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this.pending.delete(reqId)) {
                    reject(new Error("map snapshot timeout"));
                }
            }, timeoutMs);
            this.pending.set(reqId, { resolve, reject, timeoutId });
            const data: MapSnapshotRequestNotification = {
                reqId,
                lat: req.lat,
                lon: req.lon,
                bearingDeg: req.bearingDeg,
                zoomKm: req.zoomKm,
                speedMs: req.speedMs,
            };
            this.server.notify(TRANSCODE_NOTIFY_MAP_SNAPSHOT_REQUEST, data);
        });
    }

    /** Rejects every still-pending request with an aborted error. */
    dispose(reason: string): void {
        const err = new DOMException(reason, "AbortError");
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timeoutId);
            entry.reject(err);
        }
        this.pending.clear();
    }
}

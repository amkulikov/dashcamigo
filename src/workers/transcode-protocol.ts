// Wire payloads exchanged between ui/transcode-shim.ts and
// workers/transcode-worker.ts.
//
// Writer transfer: the main side keeps the real FSA writable and hands the
// worker one end of a MessageChannel (createWorkerWritableProxy). The worker
// wraps that port in an FSA-shaped writable (wrapPortAsFsaWritable) and pipes
// write/close/abort over it; the main side applies each to the real writable.
// FSA objects themselves cannot be transferred (FileSystemWritableFileStream
// serializes as DataCloneError, and a fresh handle from showSaveFilePicker
// fails createWritable() in worker scope), and a transferable WritableStream -
// what we used before - is a DataCloneError on stable Safari (WebKit #215485).
// A MessagePort is transferable on every target browser. See port-writable.ts.

import type { TranscodeArgs, TranscodeProgress } from "../transcode/types.js";
import type { TranscodeSplitArgs } from "../transcode/pipeline-split.js";

/** Transferable subset of TranscodeArgs - runtime-only fields are passed separately. */
export type TranscodeArgsForTransfer = Omit<TranscodeArgs, "signal" | "writable" | "onProgress">;
export type TranscodeSplitArgsForTransfer = Omit<TranscodeSplitArgs, "signal" | "writable" | "onProgress">;

/** Request payload for the single-channel transcode path. */
export interface TranscodeSingleRequestData {
    args: TranscodeArgsForTransfer;
    writablePort: MessagePort;
}

/** Request payload for the split-screen transcode path. */
export interface TranscodeSplitRequestData {
    args: TranscodeSplitArgsForTransfer;
    writablePort: MessagePort;
}

/** Push notification: progress update from the encode loop. */
export interface TranscodeProgressNotificationData {
    progress: TranscodeProgress;
}

export const TRANSCODE_REQUEST_SINGLE = "transcode-single";
export const TRANSCODE_REQUEST_SPLIT = "transcode-split";
export const TRANSCODE_NOTIFY_PROGRESS = "progress";

/**
 * Map snapshot RPC built on top of notifications. The transcode worker cannot
 * touch MapLibre (no DOM / WebGL), so it asks the main thread for a rendered
 * snapshot per frame and waits for the matching response.
 *
 * Symmetric notification names; reqId correlates request to response. We keep
 * a separate "error" carrier so the worker can reject the pending promise on
 * a main-side failure (style load fail / map disposed mid-export) without
 * tearing down the whole transcode.
 */
export const TRANSCODE_NOTIFY_MAP_SNAPSHOT_REQUEST = "map-snapshot-req";
export const TRANSCODE_NOTIFY_MAP_SNAPSHOT_RESPONSE = "map-snapshot-res";

export interface MapSnapshotRequestNotification {
    reqId: number;
    lat: number;
    lon: number;
    bearingDeg: number;
    zoomKm: number;
    /** Car speed (m/s) for the chase camera's speed-adaptive zoom. */
    speedMs: number;
}

export interface MapSnapshotResponseNotification {
    reqId: number;
    bitmap?: ImageBitmap;
    error?: string;
}

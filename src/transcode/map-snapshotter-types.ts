// Shared interface that lets the pipeline ask "give me a rendered map image
// for this lat/lon/bearing". Implemented:
//  - on the main thread by the export modal (calls ExportMapSnapshotter
//    directly, in-process);
//  - inside the transcode worker by MapSnapshotWorkerClient (forwards the
//    request to the main thread over the worker bridge).
//
// The pipeline does not need to know which one it has - both produce
// ImageBitmaps that can be drawn onto OffscreenCanvas with drawImage.

export interface MapSnapshotRequest {
    lat: number;
    lon: number;
    bearingDeg: number;
    zoomKm: number;
    /** Car speed (m/s) at this frame. Feeds the chase camera's speed-adaptive
     *  zoom; ignored for north-up. The chase mode / tilt / adaptive-on flags are
     *  NOT carried here - they are render-only settings the main-thread
     *  snapshotter reads from the export panel state (like the base-layer theme). */
    speedMs: number;
}

export interface MapSnapshotter {
    snapshot(req: MapSnapshotRequest): Promise<ImageBitmap>;
}

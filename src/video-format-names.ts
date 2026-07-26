// Filename-based container detection. Deliberately PURE - no mediabunny import.
//
// Kept separate from video-formats.ts (which module-evals
// `VIDEO_INPUT_FORMATS = [MP4, QTFF, MPEG_TS]` and therefore drags the ~240KB
// mediabunny lib in at import time). The main-thread ingest path needs only this
// filename check, so importing it from here - instead of video-formats.ts -
// keeps mediabunny off the landing critical path (T9). Worker bundles import
// VIDEO_INPUT_FORMATS directly and carry their own mediabunny copy regardless.

// True for MPEG-TS sticks (.ts/.m2ts) that write no moov box - playback routes
// through MSE remux regardless of browser (see per-file-mse.ts).
export function isTransportStreamName(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith(".ts") || lower.endsWith(".m2ts");
}

// True for Matroska (.mkv). Browsers do not play Matroska through <video>.src
// (only WebM), so - like MPEG-TS - every .mkv routes through MSE remux: mediabunny
// demuxes it and the worker remuxes to fragmented MP4 (see per-file-mse.ts).
export function isMatroskaName(name: string): boolean {
    return name.toLowerCase().endsWith(".mkv");
}

// True for any container that is not natively decodable via <video>.src and must
// go through the mediabunny-backed index/playback path instead of the ISOBMFF
// moov walk. Single source of truth for the "non-ISOBMFF, remux to play" family.
export function isNonIsobmffContainerName(name: string): boolean {
    return isTransportStreamName(name) || isMatroskaName(name);
}

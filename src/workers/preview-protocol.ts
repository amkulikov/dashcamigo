// Wire payloads between ui/trip-preview.ts and workers/preview-worker.ts.

/** Request payload for "extract-preview". One file per request. */
export interface PreviewExtractRequestData {
    file: File;
}

/** Response. null = file did not decode (no video track / unsupported codec). */
export interface PreviewExtractResult {
    dataUrl: string | null;
}

export const PREVIEW_REQUEST_EXTRACT = "extract-preview";

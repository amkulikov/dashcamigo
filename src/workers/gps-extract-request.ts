// Pure worker-request adapter. Keeping the argument wiring out of the worker's
// side-effectful server bootstrap lets cache revisions cover it precisely.

import { dispatchParseVideoEmbeddedGps } from "../parsers/registry.js";
import type { ExtractRequestData, ExtractResult, ProgressNotificationData } from "./gps-extract-protocol.js";

export function dispatchGpsExtractRequest(
    request: ExtractRequestData,
    signal: AbortSignal,
    notifyProgress: (progress: ProgressNotificationData) => void,
): Promise<ExtractResult> {
    return dispatchParseVideoEmbeddedGps(
        request.classified,
        (done, total, file) => {
            notifyProgress({
                token: request.token,
                done,
                total,
                fileName: file.file.name,
            });
        },
        request.concurrency,
        signal,
        request.mode,
        request.prebuiltMoovByPath,
    );
}

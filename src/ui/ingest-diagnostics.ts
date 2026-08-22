import { createLogger } from "../log.js";
import { captureSentryMessage } from "../sentry.js";

import { state } from "./state.js";

const log = createLogger("ingest");

/** Reports parser failures by stage and parser without sending file names. */
export function reportParseErrors(
    stage: string,
    errors: ReadonlyArray<{ extractor?: string; sidecarId?: string }>,
): void {
    if (errors.length === 0) return;
    const byParser = new Map<string, number>();
    for (const error of errors) {
        const parser = error.extractor ?? error.sidecarId ?? "unknown";
        byParser.set(parser, (byParser.get(parser) ?? 0) + 1);
    }
    for (const [parser, count] of byParser) {
        captureSentryMessage("gps parse failed", {
            level: "warning",
            fingerprint: ["gps_parse_failed", stage, parser],
            tags: { stage, parser },
            extra: { count },
        });
    }
}

/** Logs malformed GPS records added after the supplied cumulative baseline. */
export function reportSkippedGpsRecords(baseline: number): void {
    const skipped = (state.gpsLog?.skipped ?? []).slice(baseline);
    if (skipped.length === 0) return;
    const byReason = new Map<string, number>();
    for (const record of skipped) byReason.set(record.reason, (byReason.get(record.reason) ?? 0) + 1);
    log.warn("gps records skipped", {
        total: skipped.length,
        byReason: Object.fromEntries(byReason),
    });
}

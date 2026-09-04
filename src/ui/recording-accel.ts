import type { AccelSample } from "../parsers/types.js";
import type { VideoCandidate } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";
import { mergeAccelIntoCandidates } from "./ingest-core.js";

interface RecordingAccelSources {
    sidecar?: AccelSample[];
    embedded?: AccelSample[];
}

/** Raw samples follow candidates across cancelled runs until their final clock merge. */
export function createRecordingAccelStore() {
    const sources = new WeakMap<VideoCandidate, RecordingAccelSources>();
    return {
        register(
            candidates: readonly VideoCandidate[],
            kind: keyof RecordingAccelSources,
            samplesByFileKey: ReadonlyMap<string, AccelSample[]>,
        ): void {
            if (samplesByFileKey.size === 0) return;
            for (const candidate of candidates) {
                const samples = samplesByFileKey.get(vendorFileKey(candidate));
                if (!samples) continue;
                const current = sources.get(candidate) ?? {};
                current[kind] = samples;
                sources.set(candidate, current);
            }
        },
        merge(candidates: readonly VideoCandidate[]): number {
            const samplesByFileKey = new Map<string, AccelSample[]>();
            const records = [];
            for (const candidate of candidates) {
                const current = sources.get(candidate);
                const samples = current?.sidecar ?? current?.embedded;
                if (!samples) continue;
                samplesByFileKey.set(vendorFileKey(candidate), samples);
                for (const record of candidate.records) records.push(record);
            }
            return mergeAccelIntoCandidates(records, samplesByFileKey, candidates);
        },
        release(candidates: readonly VideoCandidate[]): void {
            for (const candidate of candidates) sources.delete(candidate);
        },
    };
}

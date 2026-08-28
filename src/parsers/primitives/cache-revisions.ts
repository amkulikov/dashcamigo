import {
    VIDEO_EMBEDDED_DISPATCH_CACHE_REVISION,
    VIDEO_EMBEDDED_PRIMITIVE_CACHE_REVISIONS,
} from "./cache-revisions.generated.js";

function fingerprint(value: string): string {
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < value.length; i++) {
        hash ^= BigInt(value.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
}

interface PrimitiveRevision {
    id: string;
    revision: string;
}

export interface EmbeddedGpsDispatchRevisions {
    byExtractor: ReadonlyMap<string, string>;
    noMatch: string;
}

/** Builds prefix revisions from registry order. Exported for invariant tests. */
export function buildEmbeddedGpsDispatchRevisions(
    primitives: readonly PrimitiveRevision[],
    commonRevision: string | number,
): EmbeddedGpsDispatchRevisions {
    const byExtractor = new Map<string, string>();
    let prefix = `dispatch:${commonRevision}`;
    for (const primitive of primitives) {
        prefix += `|${primitive.id}:${primitive.revision}`;
        byExtractor.set(primitive.id, fingerprint(prefix));
    }
    return { byExtractor, noMatch: fingerprint(prefix) };
}

const currentRevisions = buildEmbeddedGpsDispatchRevisions(
    VIDEO_EMBEDDED_PRIMITIVE_CACHE_REVISIONS,
    VIDEO_EMBEDDED_DISPATCH_CACHE_REVISION,
);

/**
 * Revision of every dispatcher decision that can precede and include this
 * extractor. A parser inserted or changed later cannot affect an earlier
 * winner; one inserted or changed before it invalidates the cached decision.
 */
export function embeddedGpsDispatchRevision(extractorId: string): string | null {
    return currentRevisions.byExtractor.get(extractorId) ?? null;
}

/** Every primitive participates in a verified "no embedded GPS" result. */
export function noEmbeddedGpsDispatchRevision(): string {
    return currentRevisions.noMatch;
}

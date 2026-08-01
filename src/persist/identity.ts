import type { FileIdentity } from "./types.js";

/**
 * Builds the cross-session identity for a file discovered at `relativePath`
 * (relative to the remembered folder root, filename included). Reads only
 * File metadata, never bytes.
 */
export function fileIdentityOf(file: File, relativePath: string): FileIdentity {
    return { relativePath, size: file.size, lastModified: file.lastModified };
}

// NUL separator: no filesystem allows NUL in a path, so joining fields with it
// cannot collide across field boundaries (e.g. size 1 + mtime 12 vs size 11 +
// mtime 2). Built via fromCharCode to keep the source file free of raw NUL bytes.
const KEY_SEPARATOR = String.fromCharCode(0);

/** Stable string form of an identity, used in IndexedDB keys and TripAnchor. */
export function fileIdentityKey(identity: FileIdentity): string {
    return [identity.relativePath, identity.size, identity.lastModified].join(KEY_SEPARATOR);
}

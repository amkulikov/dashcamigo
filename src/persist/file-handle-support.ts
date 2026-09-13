// Chromium's in-memory IndexedDB can terminate the browser when it restores a
// FileSystemHandle. A round-trip probe would itself crash, and private browsing
// has no reliable detection API. Keep this exception separate from capabilities.
// TODO: Narrow this guard after verifying an upstream fix with native handles
// in both regular and private contexts; do not assume a new major fixes it.

interface BrowserIdentity extends Navigator {
    userAgentData?: { brands: ReadonlyArray<{ brand: string; version: string }> };
}

export function canPersistFileHandles(): boolean {
    if (typeof navigator === "undefined") return true;
    const identity = navigator as BrowserIdentity;
    const chromium = identity.userAgentData?.brands?.find(({ brand }) => brand === "Chromium");
    const hintedVersion = Number(chromium?.version);
    const version =
        Number.isInteger(hintedVersion) && hintedVersion > 0
            ? hintedVersion
            : Number(/(?:Chrome|Chromium)\/(\d+)/.exec(identity.userAgent)?.[1]);
    return !Number.isFinite(version) || version < 153;
}

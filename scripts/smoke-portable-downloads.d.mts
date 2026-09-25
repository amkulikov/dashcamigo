import type { PortableManifest } from "../src/portable/manifest.mjs";

export declare function verifyPublishedPortableDownloads(
    expected: PortableManifest,
    origin: string,
    allowDevelopment?: boolean,
): Promise<void>;

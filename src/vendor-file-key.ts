import type { VendorFile } from "./parsers/types.js";

const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * Session metadata identity of one file version. `relativePath` alone is only
 * unique inside a picked source: two cards can expose the same tree, and a
 * dashcam can overwrite a loop-recording path while the app stays open. Like
 * the persistent cache, this cannot distinguish an overwrite that preserves
 * both byte length and lastModified without reading the whole file.
 */
export function vendorFileKey(file: VendorFile): string {
    return [file.sourceKey ?? "", file.relativePath || file.file.name, file.file.size, file.file.lastModified].join(
        KEY_SEPARATOR,
    );
}

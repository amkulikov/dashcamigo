import { describe, expect, it } from "vitest";

import type { VendorFile } from "./parsers/types.js";
import { vendorFileKey } from "./vendor-file-key.js";

function file(sourceKey: string, size: number, lastModified: number): VendorFile {
    return {
        file: new File([new Uint8Array(size)], "clip.mp4", { lastModified }),
        relativePath: "CARD/DCIM/clip.mp4",
        sourceKey,
    };
}

describe("vendorFileKey", () => {
    it("changes across physical sources with an equal tree", () => {
        expect(vendorFileKey(file("card-a", 10, 1))).not.toBe(vendorFileKey(file("card-b", 10, 1)));
    });

    it("changes when a dashcam overwrites the same path", () => {
        expect(vendorFileKey(file("card", 10, 1))).not.toBe(vendorFileKey(file("card", 10, 2)));
        expect(vendorFileKey(file("card", 10, 1))).not.toBe(vendorFileKey(file("card", 11, 1)));
    });
});

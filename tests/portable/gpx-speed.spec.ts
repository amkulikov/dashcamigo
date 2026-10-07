import { verifyGpxSpeed } from "../e2e/_gpx-speed.js";
import { presetLocalStorage } from "../e2e/_fixtures.js";
import { openPortable, test } from "./_fixtures.js";

for (const mode of ["sidecar", "manual"] as const) {
    test(`GPX ${mode} speed estimates survive file-origin import and export`, async ({ page }, info) => {
        await presetLocalStorage(page);
        await openPortable(page, info.outputPath(mode));
        await verifyGpxSpeed(page, mode, "Estimated speed");
    });
}

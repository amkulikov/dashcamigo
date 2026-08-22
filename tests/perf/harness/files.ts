// File delivery to the browser via Playwright.
//
// Path: <input type="file" webkitdirectory id="folder-input"> + setInputFiles.
// Playwright accepts absolute paths and materializes lazy-backed File objects
// identical to what the user gets via the system file-picker. For
// input[webkitdirectory] it also computes webkitRelativePath from the file
// paths' common ancestor.
//
// The dashcamigo pipeline relies on webkitRelativePath for channel/mode
// heuristics (parsers/filename/*). cold-ingest.spec.ts checks that the
// app's "ingest started" log carries a non-bare relativePathsSample and
// warns once per vendor if Playwright/Chromium did not preserve the layout
// (rare - usually means a Playwright version regression).

import type { Page } from "@playwright/test";

/**
 * Sets the dashcamigo file-input value to a directory path. Playwright sees
 * the <input webkitdirectory> attribute and recursively walks the directory,
 * computing webkitRelativePath for each file (rooted at the directory name).
 *
 * This is the only working setInputFiles shape for webkitdirectory inputs:
 * passing an array of file paths errors out with "[webkitdirectory] input
 * requires passing a path to a directory" since Playwright 1.41+.
 */
export async function deliverFiles(page: Page, vendorAbsPath: string): Promise<void> {
    const input = page.locator("#folder-input");
    await input.setInputFiles(vendorAbsPath);
}

/** Initializes the browser-side measurement bag before application code runs. */
export const HARNESS_INIT_SCRIPT = `
(() => {
    window.__dashcamigoPerf ||= {};
})();
`;

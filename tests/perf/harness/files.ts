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

/**
 * Init script: auto-accepts the heavy-embedded-GPS prompt. ingest.ts shows
 * askEmbeddedGpsPrompt() for Novatek-class vendors (SilverStone, Juscar,
 * BlackVue ELITE 9, etc) where embedded-GPS extraction requires a streaming
 * scan of the full file. In a perf test no one answers - the ingest hangs
 * forever waiting on the dialog. Auto-clicking 'Yes' makes us actually
 * measure the heavy extraction (stageMs.embeddedGpsHeavy in the report);
 * auto-clicking 'No' would skip it and give misleading numbers (vendor
 * would look free, but real users would either see the prompt or suffer
 * the cost later).
 *
 * addInitScript runs BEFORE document.documentElement exists - the DOM
 * tree isn't built yet. Defer install to DOMContentLoaded; observe the
 * modal element directly once it's parsed.
 */
export const HARNESS_INIT_SCRIPT = `
(() => {
    window.__dashcamigoPerf ||= {};
    const installAutoYes = () => {
        const modal = document.getElementById('embedded-gps-prompt-modal');
        const yesBtn = document.getElementById('embedded-gps-prompt-yes');
        if (!modal || !yesBtn) return false;
        const tryClick = () => {
            if (!modal.hidden) yesBtn.click();
        };
        tryClick();  // in case it was already visible
        const obs = new MutationObserver(tryClick);
        obs.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
        return true;
    };
    const start = () => {
        if (installAutoYes()) return;
        // Modal not in DOM yet - watch for it. document.body is guaranteed
        // here (we ran after DOMContentLoaded).
        const mo = new MutationObserver(() => { if (installAutoYes()) mo.disconnect(); });
        mo.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
`;

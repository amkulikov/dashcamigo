// Loading self-hosted fonts into a canvas-drawing scope (overlay text, watermark).
//
// In a Worker there is no `document` and the main thread's CSS @font-face does
// NOT apply, so `self.fonts` (FontFaceSet) starts empty and canvas text falls
// back to a system font. We construct FontFace objects from the self-hosted
// woff2 files and add them to the scope's font set. Runs the same on the main
// thread (harmless next to the CSS faces). Shared by overlay-styles.ts and
// watermark.ts so there is one worker-font path, not two.

import { createLogger } from "../log.js";

const log = createLogger("transcode:fonts");

export interface FontSpec {
    family: string;
    /** CSS weight descriptor - a single weight ("700") or a variable range ("100 900"). */
    weight: string;
    /** Stable public/ URL, served at origin root by Vite (unhashed). */
    url: string;
}

/**
 * Registers `specs` into the current scope's FontFaceSet (worker: self.fonts;
 * main thread: document.fonts) and resolves once they have loaded. Defensive
 * throughout: a missing FontFaceSet, a missing FontFace constructor (very old
 * engines), or a failed fetch each degrade to the ctx.font system fallback
 * rather than throwing - burned-in text (overlays, watermark) is cosmetic and
 * must never abort an export. Never rejects.
 */
export async function loadFontsIntoScope(specs: readonly FontSpec[]): Promise<void> {
    const fontsApi: FontFaceSet | undefined =
        typeof document !== "undefined" ? document.fonts : (globalThis as { fonts?: FontFaceSet }).fonts;
    const FontFaceCtor = (globalThis as { FontFace?: typeof FontFace }).FontFace;
    if (!fontsApi || typeof FontFaceCtor !== "function") {
        log.info("FontFace API unavailable, using system-font fallback");
        return;
    }
    await Promise.all(
        specs.map(async (spec) => {
            try {
                const face = new FontFaceCtor(spec.family, `url(${spec.url})`, { weight: spec.weight });
                await face.load();
                fontsApi.add(face);
            } catch (err) {
                log.info("font load failed, using fallback", { family: spec.family, err: String(err) });
            }
        }),
    );
}

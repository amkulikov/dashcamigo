// Emits the IndexNow proof-of-ownership file `dist/<key>.txt` from the
// INDEXNOW_KEY env var (node context only - no VITE_ prefix, so the value can
// never be inlined into the client bundle).
//
// Why env, not a committed file in public/: the IndexNow spec says "Only you
// and the search engines should know the key and your file key location". The
// key's only protection is that its URL is unguessable - the file is served
// but never linked (not in sitemap, robots.txt, or the SW precache manifest,
// which is an explicit allowlist in vite-plugins/sw-precache.ts; keep it that
// way). Committing the filename to a public repo would disclose it, letting
// anyone spam IndexNow endpoints on our behalf until engines throttle the key.
//
// Unset env -> no file, silently: local dev and self-host forks have no key
// and IndexNow simply stays off. Set-but-malformed -> fail the build: the
// value becomes a public URL path and the ping payload, so shipping a broken
// one would 403/422 on every engine.
//
// The other consumer of the same GitHub Actions secret is the post-deploy
// ping (the ping job of .github/workflows/release.yml ->
// scripts/indexnow-ping.mjs) - it pre-flight-fetches the live keyLocation
// before submitting, so a half-deployed rotation fails loudly.

import type { Plugin } from "vite";

// IndexNow key format per spec: 8-128 chars of a-z, A-Z, 0-9 and dashes.
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

export function indexnowKeyPlugin(): Plugin {
    return {
        name: "dashcamigo-indexnow-key",
        apply: "build",
        generateBundle() {
            // Real env only (GitHub Actions secret / shell export) - same
            // pattern as SENTRY_* in vite.config.ts. Vite does NOT load
            // non-VITE_ vars from .env files into process.env, and that is
            // fine here: the key deliberately lives in no file at all.
            const key = (process.env.INDEXNOW_KEY ?? "").trim();
            if (key.length === 0) return;
            if (!KEY_FORMAT.test(key)) {
                throw new Error(
                    "indexnow-key: INDEXNOW_KEY must be 8-128 chars of [a-zA-Z0-9-] " +
                        "(it becomes a public URL path and the IndexNow payload)",
                );
            }
            this.emitFile({ type: "asset", fileName: `${key}.txt`, source: key });
        },
    };
}

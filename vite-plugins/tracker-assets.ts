// Self-hosts the blur-zone auto-tracker's runtime assets under cache-busted,
// same-origin URLs (no CDN: nothing external at runtime), and keeps them OUT of
// the PWA precache - the wasm+models are a lazy TRACKER-cached download, not
// part of the offline boot shell.
//
// WHY cache-busted URLs: these files change bytes when the dependency upgrades,
// but their paths are otherwise stable. onnxruntime-web keeps the same wasm
// filename across versions, and a re-exported ONNX model can reuse its name - so
// an offline PWA could serve a stale copy against freshly-precached glue (an ORT
// ABI mismatch, a hard init crash) or run stale model weights (silent-wrong
// output). Fingerprinting the URL is the same immutable-asset defense the
// bundler already gives /assets/:
//   - ORT: the loader appends the fixed filename itself, so we can only bust the
//     DIRECTORY -> /ort/<ort-version>/. The pinned version is a faithful content
//     key (bytes change iff the onnxruntime-web version changes).
//   - models: we own the fetch URL fully, so we content-hash the FILENAME
//     -> <name>.<hash>.onnx. This catches even a re-export with identical
//     arch/size (different bytes -> different URL).
// A new URL is a new TRACKER cache entry, a new localStorage "downloaded" flag,
// and no way to serve old bytes as new; the SW drops superseded entries on
// activate (see TRACKER_ASSET_URLS in public/sw.js).
//
// Dev keeps the original unbusted URLs (offline is a production concern); the
// build emits the busted layout. `vite preview` / e2e serve the built dist, so
// they exercise the real busted URLs.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

const ORT_DIST = resolve("node_modules/onnxruntime-web/dist");
const ORT_PKG = resolve("node_modules/onnxruntime-web/package.json");

// Plain pair: the wasm EP (vittrack + no-WebGPU detection). Asyncify pair: what
// ort's WebGPU EP actually loads (the detection pass on WebGPU machines) - NOT
// the jsep build, which this ort release keeps for other backends.
const ORT_FILES = [
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
    "ort-wasm-simd-threaded.asyncify.mjs",
] as const;

// The tracker's ONNX models, public-relative, keyed by the logical name the app
// requests (blur-assets.ts). Their bytes decide detection quality, so a stale
// copy is silent-wrong-output rather than a crash - hence the content hash.
const MODELS = [
    { key: "tracker", rel: "models/vittrack/object_tracking_vittrack_2023sep.onnx" },
    { key: "plate", rel: "models/plate/yolo-v9-s-608-license-plates-end2end-fp16.onnx" },
    { key: "face", rel: "models/face/yolov9s-face-960-fp16.onnx" },
] as const;

const MIME: Record<string, string> = {
    ".wasm": "application/wasm",
    ".mjs": "text/javascript",
};

/** App-facing asset URLs consumed by src/ui/blur-assets.ts via the
 *  __DC_TRACKER_ASSETS__ define. */
export interface TrackerAssetsApp {
    /** Directory prefix the ort loader appends its own filename to. */
    ortDir: string;
    /** Content-hashed same-origin model URLs, by logical name. */
    models: { tracker: string; plate: string; face: string };
}

export interface TrackerAssets {
    app: TrackerAssetsApp;
    /** Flat set of the build's cache-busted URLs, injected into public/sw.js so
     *  the activate handler drops superseded TRACKER entries. Empty in dev. */
    urls: string[];
    /** onnxruntime-web version stamped into the /ort/ dir; null in dev. */
    ortVersion: string | null;
    /** Per-model emit plan for the build (public-relative source -> hashed dist
     *  path + url). Empty in dev. */
    modelEmit: Array<{ rel: string; distRel: string; url: string }>;
}

function sha8(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

function readOrtVersion(): string {
    const pkg = JSON.parse(readFileSync(ORT_PKG, "utf-8")) as { version?: string };
    if (!pkg.version) throw new Error("tracker-assets: onnxruntime-web has no version in package.json");
    return pkg.version;
}

// Insert `.<hash>` before the extension: models/x/name.onnx -> models/x/name.<hash>.onnx.
function bustModelRel(rel: string, hash: string): string {
    return rel.replace(/\.onnx$/, `.${hash}.onnx`);
}

/**
 * Computes the cache-busted (build) or original (dev) tracker asset URLs plus
 * the build's emit plan. Pure over the source files (node_modules ort +
 * public/models), so it runs at vite-config time to feed both the
 * __DC_TRACKER_ASSETS__ define and trackerAssetsPlugin from one hash pass.
 *
 * Dev keeps the original unbusted URLs: offline is a production concern, and the
 * dev server streams /ort/ from node_modules and /models/ from public/ as-is, so
 * busting there would only add startup cost and a dev-only URL layout.
 */
export function computeTrackerAssets(command: "serve" | "build", root = process.cwd()): TrackerAssets {
    if (command !== "build") {
        return {
            app: {
                ortDir: "/ort/",
                models: {
                    tracker: `/${MODELS[0].rel}`,
                    plate: `/${MODELS[1].rel}`,
                    face: `/${MODELS[2].rel}`,
                },
            },
            urls: [],
            ortVersion: null,
            modelEmit: [],
        };
    }
    const ortVersion = readOrtVersion();
    const ortDir = `/ort/${ortVersion}/`;
    const models: Record<string, string> = {};
    const modelEmit: TrackerAssets["modelEmit"] = [];
    for (const m of MODELS) {
        const hash = sha8(readFileSync(resolve(root, "public", m.rel)));
        const distRel = bustModelRel(m.rel, hash);
        const url = `/${distRel}`;
        models[m.key] = url;
        modelEmit.push({ rel: m.rel, distRel, url });
    }
    const urls = [...ORT_FILES.map((f) => `${ortDir}${f}`), ...Object.values(models)];
    return { app: { ortDir, models: models as TrackerAssetsApp["models"] }, urls, ortVersion, modelEmit };
}

const SW_PLACEHOLDER = /const TRACKER_ASSET_URLS = \[\];\s*\/\/ __DC_TRACKER_ASSET_URLS__/;

/**
 * Emits the busted asset layout at build time and streams the unbusted /ort/
 * files in dev. Takes the precomputed manifest so the config's define and this
 * plugin share one hash pass (no double-read of the ~megabyte model files).
 */
export function trackerAssetsPlugin(assets: TrackerAssets): Plugin {
    return {
        name: "dashcamigo-tracker-assets",
        configureServer(server) {
            // Dev serves /ort/ from node_modules verbatim (unbusted URLs match
            // computeTrackerAssets("serve")); models are served by Vite from
            // public/ under their original names, so nothing to add for them.
            server.middlewares.use("/ort", (req, res, next) => {
                const name = (req.url ?? "").split("?")[0]?.replace(/^\//, "") ?? "";
                if (!(ORT_FILES as readonly string[]).includes(name)) return next();
                const file = join(ORT_DIST, name);
                if (!existsSync(file)) return next();
                const ext = name.slice(name.lastIndexOf("."));
                res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
                res.end(readFileSync(file));
            });
        },
        closeBundle() {
            // Vitest loads the shared Vite config with command="serve" and
            // still runs closeBundle when its module graph shuts down. The dev
            // plugin is needed for configureServer above, but it must never
            // rewrite an existing dist/ (or race a build running alongside the
            // unit suite). A non-null version is the build-only invariant from
            // computeTrackerAssets().
            if (assets.ortVersion === null) return;

            // 1) ORT wasm/glue -> dist/ort/<version>/ (the version-stamped dir the
            // loader points wasmPaths at - see computeTrackerAssets for why ORT is
            // busted by directory, not filename).
            const outDir = resolve("dist/ort", assets.ortVersion ?? "");
            mkdirSync(outDir, { recursive: true });
            for (const name of ORT_FILES) {
                const src = join(ORT_DIST, name);
                if (!existsSync(src)) {
                    throw new Error(
                        `tracker-assets: ${name} missing in node_modules/onnxruntime-web/dist - dependency not installed?`,
                    );
                }
                copyFileSync(src, join(outDir, name));
            }
            // Drop the bundler-emitted duplicate of the wasm under /assets/. The
            // tracker worker bundles onnxruntime-web, so Rolldown emits the wasm as
            // a hashed /assets/ asset, but the runtime NEVER fetches it: loadOrt
            // sets wasmPaths to /ort/<version>/ before any session init. Removing
            // it keeps /assets/ (and the self-host zip) lean; sw-precache also
            // skips *.wasm, so the offline shell is unaffected either way.
            const assetsDir = resolve("dist/assets");
            if (existsSync(assetsDir)) {
                for (const name of readdirSync(assetsDir)) {
                    if (/^ort-wasm.*\.wasm$/.test(name)) rmSync(join(assetsDir, name));
                }
            }
            // 2) Content-hash the models: Vite copied public/models verbatim into
            // dist/models/ under their original names; rename each to its hashed
            // name and drop the original so only the busted URL is served.
            for (const e of assets.modelEmit) {
                const srcDist = resolve("dist", e.rel);
                const dstDist = resolve("dist", e.distRel);
                if (!existsSync(srcDist)) {
                    throw new Error(`tracker-assets: model ${e.rel} missing in dist - public copy did not run first?`);
                }
                mkdirSync(dirname(dstDist), { recursive: true });
                copyFileSync(srcDist, dstDist);
                rmSync(srcDist);
            }
            // 3) Inject the current asset URL set into dist/sw.js so the activate
            // handler drops superseded TRACKER entries. Mirrors sw-precache's
            // placeholder replacement; must run before minifyServiceWorker (later
            // in the plugin array).
            const swPath = resolve("dist/sw.js");
            if (existsSync(swPath)) {
                const sw = readFileSync(swPath, "utf-8");
                if (!SW_PLACEHOLDER.test(sw)) {
                    throw new Error("tracker-assets: TRACKER_ASSET_URLS placeholder not found in dist/sw.js");
                }
                writeFileSync(
                    swPath,
                    sw.replace(SW_PLACEHOLDER, `const TRACKER_ASSET_URLS = ${JSON.stringify(assets.urls)};`),
                );
            }
        },
    };
}

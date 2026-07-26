// Readiness gate for the blur features' heavy assets: the onnxruntime-web wasm
// runtime plus the per-feature ONNX models (vittrack for Follow, the plate and
// face detectors for the "blur all ..." checkboxes). The workers fetch these
// lazily, but that fetch is silent - on a slow link the user stares at a frozen
// button while megabytes download, and offline it just fails.
//
// This module front-loads the download from the MAIN thread with a determinate
// progress bar, so the panel can ask for consent, show progress, and explain the
// offline story BEFORE anything heavy happens. Warming here also warms the HTTP
// + service-worker (TRACKER) cache, so the worker's own fetch for the same URLs
// is a cache hit - the bytes are downloaded exactly once, not twice.
//
// Assets are grouped per feature; a request names the groups it needs and the
// consent copy prices only the files this device has never pulled (the detect
// groups share the webgpu runtime, so consenting to plates makes the faces
// checkbox later cost just the face model). Downloads are opt-in and
// remembered per FILE in localStorage. No UI here - the panel subscribes.

import { createLogger } from "../log.js";
import { isOffline } from "./connectivity.js";

const log = createLogger("blur-assets");

// Cache-busted, same-origin URLs of the tracker's runtime assets, injected at
// build time by vite-plugins/tracker-assets.ts: the ort wasm under a
// version-stamped dir, the models content-hashed. Single source of truth - the
// pass clients hand these to the workers so the warmed cache and the worker
// fetch line up. (Self-hosted, no CDN: the no-backend + CSP rules mean nothing
// external at runtime.) The typeof guard falls back to the unbusted dev/test
// URLs when the define is absent (vitest, ts-runner - no define propagation),
// where the exact URL is functionally irrelevant. See src/version.ts for the
// same pattern.
declare const __DC_TRACKER_ASSETS__:
    | { ortDir: string; models: { tracker: string; plate: string; face: string } }
    | undefined;

const TRACKER_ASSETS =
    typeof __DC_TRACKER_ASSETS__ !== "undefined"
        ? __DC_TRACKER_ASSETS__
        : {
              ortDir: "/ort/",
              models: {
                  tracker: "/models/vittrack/object_tracking_vittrack_2023sep.onnx",
                  plate: "/models/plate/yolo-v9-t-512-license-plates-end2end.onnx",
                  face: "/models/face/yolov9s-face-960-fp16.onnx",
              },
          };

export const TRACKER_MODEL_URL = TRACKER_ASSETS.models.tracker;
export const PLATE_MODEL_URL = TRACKER_ASSETS.models.plate;
export const FACE_MODEL_URL = TRACKER_ASSETS.models.face;
export const TRACKER_ORT_WASM_DIR = TRACKER_ASSETS.ortDir;

/** Feature-facing asset groups: Follow needs the tracker model, each detect
 *  checkbox needs its detector model; all three need the shared ORT runtime. */
export type BlurAssetGroupId = "track" | "detect-plate" | "detect-face";

/** approxMb only steers the progress bar weights and the consent price tag -
 *  it does NOT need to track real file sizes exactly, so an ORT/model bump can
 *  shift sizes without breaking anything. */
interface AssetSpec {
    url: string;
    approxMb: number;
}

const ORT_WASM_ASSETS: readonly AssetSpec[] = [
    { url: `${TRACKER_ORT_WASM_DIR}ort-wasm-simd-threaded.wasm`, approxMb: 13.3 },
    { url: `${TRACKER_ORT_WASM_DIR}ort-wasm-simd-threaded.mjs`, approxMb: 0.1 },
];

// What ort's WebGPU EP loads (the asyncify build). Bigger than the plain wasm
// pair, but it buys a ~7x faster detection pass (see tracking/ort-runtime.ts).
const ORT_WEBGPU_ASSETS: readonly AssetSpec[] = [
    { url: `${TRACKER_ORT_WASM_DIR}ort-wasm-simd-threaded.asyncify.wasm`, approxMb: 24.2 },
    { url: `${TRACKER_ORT_WASM_DIR}ort-wasm-simd-threaded.asyncify.mjs`, approxMb: 0.1 },
];

function groupAssets(group: BlurAssetGroupId): readonly AssetSpec[] {
    switch (group) {
        case "track":
            return [...ORT_WASM_ASSETS, { url: TRACKER_MODEL_URL, approxMb: 0.7 }];
        case "detect-plate":
            // Detection is WebGPU-only (the panel disables both checkboxes
            // without an adapter - see blur-detect.ts), so the detect groups
            // always price the webgpu runtime. The detect pass ALSO follows each
            // hit with vittrack (on that same webgpu runtime's wasm EP - no
            // second ort build), so it prices the tracker MODEL too; the Follow
            // pass stays on the plain wasm pair (validated there).
            return [
                ...ORT_WEBGPU_ASSETS,
                { url: TRACKER_MODEL_URL, approxMb: 0.7 },
                { url: PLATE_MODEL_URL, approxMb: 7.8 },
            ];
        case "detect-face":
            return [
                ...ORT_WEBGPU_ASSETS,
                { url: TRACKER_MODEL_URL, approxMb: 0.7 },
                { url: FACE_MODEL_URL, approxMb: 12.8 },
            ];
    }
}

/** Abort a warm if no bytes arrive for this long. Guards the "connected but no
 *  internet" limbo where navigator.onLine stays true and a bare fetch hangs on
 *  the OS TCP timeout (tens of seconds) instead of rejecting - without this the
 *  progress bar would freeze at 0% with no way out. Reset on every chunk, so a
 *  slow-but-progressing download is never killed. */
const WARM_STALL_TIMEOUT_MS = 30_000;

// Per-file "this device has pulled it" flags. Lets later visits skip the
// consent prompt for already-cached files: the SW TRACKER cache holds them
// (incl. offline), so re-asking would be noise. A cache eviction just means the
// next pass re-downloads through the same warm path - flags are an
// optimization, not a correctness guarantee.
//
// The asset URLs are cache-busted (see TRACKER_ASSETS): an onnxruntime upgrade
// or a re-exported model changes the URL, so the flag key moves with it - a
// device never keys a stale flag to fresh bytes, and the SW drops the old
// TRACKER entries on activate.
const ASSET_DOWNLOADED_KEY_PREFIX = "dashcamigo:blurAssetDownloaded:";

export type BlurAssetsPhase =
    | "idle" // no download in flight, nothing failed
    | "downloading" // warm in flight, `progress` is live
    | "error"; // the last download failed (surfaced so the strip can offer a retry)
// Note: there is deliberately no sticky "offline" phase. Offline-ness is derived
// LIVE by the panel from blurAssetsBlockedOffline(), so a reconnect immediately
// makes the download available again instead of wedging on a phase no code path
// clears. Readiness is not a phase either - it is derived per group from the
// per-file warmed set.

export interface BlurAssetsState {
    phase: BlurAssetsPhase;
    /** 0..1 during "downloading", else meaningless. */
    progress: number;
    /** Groups the in-flight (or failed) download was asked for - the panel uses
     *  it to route progress/error to the strip that initiated the warm. */
    activeGroups: readonly BlurAssetGroupId[] | null;
}

const stateRef: BlurAssetsState = { phase: "idle", progress: 0, activeGroups: null };

// URLs fully drained THIS session - the strong readiness signal (bytes are in
// the HTTP/SW cache for sure, a worker fetch will not hit the network).
const sessionWarmed = new Set<string>();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribes to readiness/progress changes (panel strip re-render hook). */
export function subscribeBlurAssets(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emit(): void {
    for (const l of listeners) l();
}

function setState(phase: BlurAssetsPhase, progress: number, activeGroups: BlurAssetsState["activeGroups"]): void {
    stateRef.phase = phase;
    stateRef.progress = progress;
    stateRef.activeGroups = activeGroups;
    emit();
}

/** Current download snapshot (read-only). */
export function blurAssetsState(): Readonly<BlurAssetsState> {
    return stateRef;
}

function assetsOf(groups: readonly BlurAssetGroupId[]): AssetSpec[] {
    // Union preserving order, wasm first - it dominates the bytes, so the
    // progress bar moves honestly from the start.
    const seen = new Set<string>();
    const out: AssetSpec[] = [];
    for (const g of groups) {
        for (const a of groupAssets(g)) {
            if (!seen.has(a.url)) {
                seen.add(a.url);
                out.push(a);
            }
        }
    }
    return out;
}

function everDownloaded(url: string): boolean {
    try {
        // Keyed by the cache-busted URL, so a device only counts a file as pulled
        // when it pulled THAT exact version - an onnxruntime upgrade or a
        // re-exported model lands a new URL and re-prompts, honoring consent.
        return localStorage.getItem(ASSET_DOWNLOADED_KEY_PREFIX + url) === "1";
    } catch {
        return false;
    }
}

function rememberDownloaded(url: string): void {
    try {
        localStorage.setItem(ASSET_DOWNLOADED_KEY_PREFIX + url, "1");
    } catch {
        // Private mode / storage disabled: harmless, we just re-prompt next time.
    }
}

/** True once every asset of `groups` is warmed this session - the pass can run
 *  without any wait. */
export function blurAssetsReady(groups: readonly BlurAssetGroupId[]): boolean {
    return assetsOf(groups).every((a) => sessionWarmed.has(a.url));
}

/**
 * Whether a heavy download would happen if the user asked for these features
 * right now - i.e. some asset is not warmed this session AND this device has
 * never pulled it. The panel uses it to decide between a silent fast path
 * (skip the prompt, warm from cache in the background) and an explicit
 * "~N MB" consent prompt.
 */
export function blurAssetsNeedDownload(groups: readonly BlurAssetGroupId[]): boolean {
    return assetsOf(groups).some((a) => !sessionWarmed.has(a.url) && !everDownloaded(a.url));
}

/** Rounded MB the consent prompt should quote: only the files this device has
 *  never pulled. Display only. */
export function blurAssetsDownloadMb(groups: readonly BlurAssetGroupId[]): number {
    const mb = assetsOf(groups)
        .filter((a) => !sessionWarmed.has(a.url) && !everDownloaded(a.url))
        .reduce((sum, a) => sum + a.approxMb, 0);
    return Math.max(1, Math.round(mb));
}

/**
 * True when a pass cannot be satisfied: some asset is not cached anywhere on
 * this device and there is no connection to fetch it. The only honest answer is
 * "reconnect once". A device that HAS cached everything stays usable offline.
 */
export function blurAssetsBlockedOffline(groups: readonly BlurAssetGroupId[]): boolean {
    return blurAssetsNeedDownload(groups) && isOffline();
}

let inFlight: Promise<boolean> | null = null;

/**
 * Warms the groups' assets into cache with a determinate progress bar, updating
 * the shared state as it goes. Resolves true once everything requested is
 * warmed, false on failure (blocked-offline / network error / stall / abort).
 * On failure the phase is left at "error" (retriable) or "idle" (blocked-offline
 * / user abort) for the strip to render; offline-ness itself is derived live by
 * the caller. A download already in flight (even for other groups) is awaited
 * first - warms are serial, and a follow-up request usually finds its shared
 * files already warmed. Safe to call when already ready (resolves true).
 */
export async function downloadBlurAssets(groups: readonly BlurAssetGroupId[], signal?: AbortSignal): Promise<boolean> {
    // Serialize behind any in-flight warm (shared files make overlap wasteful
    // and the progress bar ambiguous). Loop: the finished warm may have covered
    // us entirely, or not at all.
    while (inFlight) {
        await inFlight.catch(() => undefined);
        if (signal?.aborted) return false;
    }
    if (blurAssetsReady(groups)) return true;
    // Known-offline (hard offline, or map-detected limbo): do not even start.
    // Leave the phase at idle - the panel shows the offline story live, and a
    // reconnect lets the very next click through.
    if (blurAssetsBlockedOffline(groups)) return false;
    inFlight = warmAll(groups, signal)
        .then(() => {
            setState("idle", 1, null);
            return true;
        })
        .catch((err: unknown) => {
            // A user cancel resets cleanly; anything else (network drop, a stalled
            // limbo fetch that hit WARM_STALL_TIMEOUT_MS) is an error the strip
            // can retry. Offline-ness is re-derived live, not pinned to a phase.
            if ((err as DOMException)?.name === "AbortError") {
                setState("idle", 0, null);
                return false;
            }
            setState("error", 0, stateRef.activeGroups);
            log.warn("blur asset download failed", { groups, err: String(err) });
            return false;
        })
        .finally(() => {
            inFlight = null;
        });
    return inFlight;
}

/** Fetches every not-yet-warmed asset in sequence, draining each body to
 *  completion so the full response lands in cache, and reports combined
 *  progress weighted by approximate size. */
async function warmAll(groups: readonly BlurAssetGroupId[], signal?: AbortSignal): Promise<void> {
    const todo = assetsOf(groups).filter((a) => !sessionWarmed.has(a.url));
    const totalMb = Math.max(
        1e-6,
        todo.reduce((sum, a) => sum + a.approxMb, 0),
    );
    setState("downloading", 0, groups);
    let baseMb = 0;
    for (const asset of todo) {
        await warmOne(asset.url, signal, (frac) => {
            setState("downloading", Math.min(1, (baseMb + asset.approxMb * frac) / totalMb), groups);
        });
        sessionWarmed.add(asset.url);
        rememberDownloaded(asset.url);
        baseMb += asset.approxMb;
        setState("downloading", Math.min(1, baseMb / totalMb), groups);
    }
}

/** Streams one asset, reporting 0..1 of ITS bytes. Draining the stream to the
 *  end is what forces the browser (and the SW's stale-while-revalidate) to store
 *  the complete response, so the worker's later fetch is a cache hit.
 *
 *  Bounded by a per-chunk stall timeout: the fetch is aborted if no bytes (or
 *  no response headers) arrive within WARM_STALL_TIMEOUT_MS, so a limbo hang
 *  surfaces as an error the user can retry instead of a frozen bar. The caller's
 *  signal (a Cancel button) is honored too. */
async function warmOne(url: string, signal: AbortSignal | undefined, onFrac: (frac: number) => void): Promise<void> {
    const stallCtrl = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = (): void => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(
            () => stallCtrl.abort(new DOMException("warm stalled", "TimeoutError")),
            WARM_STALL_TIMEOUT_MS,
        );
    };
    const merged = signal ? AbortSignal.any([signal, stallCtrl.signal]) : stallCtrl.signal;
    armStall();
    try {
        const res = await fetch(url, { signal: merged });
        if (!res.ok || !res.body) {
            throw new Error(`blur asset ${url}: ${res.status}`);
        }
        const total = Number(res.headers.get("content-length")) || 0;
        const reader = res.body.getReader();
        let received = 0;
        for (;;) {
            armStall(); // reset per chunk - only a real stall (no data) trips it
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            // No Content-Length (dev middleware / proxy): hold at an indeterminate
            // half rather than jump around; the completed-asset base still advances.
            onFrac(total > 0 ? Math.min(1, received / total) : 0.5);
        }
        onFrac(1);
    } finally {
        if (stallTimer) clearTimeout(stallTimer);
    }
}

// Build version injected by vite.config via `define` as a literal
// (see getAppVersion in vite.config.ts):
//   - build: git short SHA, with "-dirty" suffix if there are uncommitted changes.
//   - dev: same, captured at `vite dev` startup.
//   - no git repo: "unknown".
//
// Used in logger("app").info("app started", { version: APP_VERSION }) so
// that bug-report logs can be pinned to a specific commit and diff.

declare const __APP_VERSION__: string | undefined;

// typeof guard for environments outside the vite pipeline
// (e.g. vitest without define propagation, or a plain ts-runner).
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

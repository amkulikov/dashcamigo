// Git-tracked modification timestamps for sitemap <lastmod>. Google's
// 2023 sitemap guidance is explicit: "lastmod must reflect when the page's
// content was last meaningfully changed. If you cannot do this reliably,
// it is better to omit it - inaccurate values train crawlers to ignore the
// signal site-wide." We honor that by deriving lastmod from `git log -1`
// on the actual source files that produce a given URL (i18n dicts, vendor
// list, index.html, this build plugin itself) rather than stamping every
// URL with build-date.
//
// Bing in particular uses sitemap lastmod as a freshness signal for its
// AI-grounded answers (Copilot, ChatGPT browsing) - missing or fake
// lastmod silently demotes the URL for AI citation, which is one of the
// channels we care about most for "dashcam player" long-tail queries.
//
// Cache: each path is queried at most once per Node process. The cache
// lives at module scope, so a watch-mode setup that builds repeatedly in
// one process will reuse stale values across builds - acceptable for us
// because `vite build` runs in a fresh process.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root used as cwd for all git invocations. Pinned to this plugin's
// location (one up from vite-plugins/) so a build started from a subdir
// (`cd src && vite build --root ..`) doesn't silently produce empty git
// output and null lastmods.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Cache of source-file-path -> ISO 8601 UTC datetime string (or null when the
// file is not git-tracked / git is unavailable). Cleared at module import,
// rebuilt as paths are queried.
const cache = new Map<string, string | null>();

// Whether per-file `git log` answers can be trusted. Lazily computed once.
// null = not checked yet.
let historyTrusted: boolean | null = null;

// CI builders (Cloudflare Pages among them) clone with --depth=1. In a
// shallow clone `git log -1 -- <file>` does NOT fail - it returns the
// single boundary commit (= HEAD) for EVERY tracked file, which stamped
// all sitemap URLs with the deploy's commit time - exactly the
// "uniform build-date lastmod" failure mode this module exists to avoid,
// disguised as valid git output.
//
// Recovery: detect the shallow clone and try a one-time `git fetch
// --unshallow` to pull the full history (the CF Pages build container has
// git and the authenticated origin remote). If the fetch fails (no
// network, credentials already dropped), per-file dates are unknowable -
// we mark history untrusted and getGitMtimeIso returns null for every
// path, so the sitemap omits <lastmod> entirely. Per Google's guidance,
// no signal beats a wrong signal.
function ensureTrustedHistory(): boolean {
    if (historyTrusted !== null) return historyTrusted;
    try {
        const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
            cwd: REPO_ROOT,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (shallow === "true") {
            // Unshallowing a typical Pages-sized repo is a few seconds once per
            // build - cheap next to the build itself. stderr is inherited so a
            // credential/network failure is visible in the build log.
            execFileSync("git", ["fetch", "--quiet", "--unshallow"], {
                cwd: REPO_ROOT,
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "inherit"],
            });
            console.warn("[git-mtime] shallow clone detected - fetched full history for sitemap lastmod");
        }
        historyTrusted = hasDistinguishableHistory();
    } catch {
        console.warn(
            "[git-mtime] no usable git history (shallow clone that could not be unshallowed, " +
                "or no repository at all) - omitting <lastmod> from sitemap.xml",
        );
        historyTrusted = false;
    }
    return historyTrusted;
}

// The same failure mode seen from the other side: with a single commit in the
// repository `git log -1 -- <file>` answers with that one commit for EVERY
// file, so every URL would carry one identical timestamp - the uniform
// build-date lastmod this module exists to avoid. That is what a repository
// looks like right after an initial import, so the gate clears itself as soon
// as a second commit gives files dates of their own.
function hasDistinguishableHistory(): boolean {
    const count = execFileSync("git", ["rev-list", "--count", "HEAD"], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (Number.parseInt(count, 10) > 1) return true;
    console.warn(
        "[git-mtime] history is a single commit - omitting <lastmod> from sitemap.xml " +
            "(every file would report the same date)",
    );
    return false;
}

// Returns the most recent committer date for the given file, formatted as
// ISO 8601 UTC ("2026-05-23T06:52:51Z"), or null when:
//   - the file is not tracked by git (new, untracked, or .gitignored);
//   - the cwd is not a git repository at all (CI archive, plain tarball);
//   - git is not installed.
//
// We read %ct (committer Unix epoch seconds) and format to UTC ourselves
// rather than using %cI (committer ISO with original TZ offset). %cI is
// machine-readable but its timezone tracks the committer's local clock -
// strings from "+05:00" coders and CI bots (UTC "Z") sort lexicographically
// in the wrong order. Normalizing to a single UTC representation makes
// `maxGitMtimeIso` a correct max-of-strings.
//
// Committer date (%ct) rather than author date (%at): committer reflects
// when the change actually landed in the branch, which is what matters for
// "when did this URL's content change". Author date can be months old after
// a rebase.
export function getGitMtimeIso(filePath: string): string | null {
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    // In an unrecoverable shallow clone every per-file answer would be the
    // same HEAD commit - worse than no answer. See ensureTrustedHistory.
    if (!ensureTrustedHistory()) {
        cache.set(filePath, null);
        return null;
    }
    let value: string | null = null;
    try {
        const out = execFileSync(
            "git",
            ["log", "-1", "--format=%ct", "--", filePath],
            {
                cwd: REPO_ROOT,
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
            },
        ).trim();
        if (out.length > 0) {
            const epochSec = Number.parseInt(out, 10);
            if (Number.isFinite(epochSec) && epochSec > 0) {
                // toISOString always emits Z (UTC) with milliseconds; we
                // strip the ".000" tail because git commits have second
                // resolution and sitemap consumers don't benefit from
                // bogus precision.
                value = new Date(epochSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
            }
        }
    } catch {
        // git missing, not a repo, file path issues - all collapse to null.
        // The caller omits <lastmod> for that URL, which is the safe choice
        // per Google's guidance: no signal is better than a wrong signal.
        value = null;
    }
    cache.set(filePath, value);
    return value;
}

// Returns the latest of all given files' git mtimes, or null when none of
// them are tracked. Because every value is normalized to UTC by
// getGitMtimeIso, lexicographic comparison is now sound: same-format
// strings ("2026-05-23T06:52:51Z") sort identically to their underlying
// instants. Don't change to local TZ without restoring Date.parse.
//
// Use this when a URL is derived from several source files: e.g. a vendor
// page depends on the vendor entry + the locale dict + the build plugin
// that renders it - any of those changing invalidates the URL.
export function maxGitMtimeIso(filePaths: ReadonlyArray<string>): string | null {
    let best: string | null = null;
    for (const path of filePaths) {
        const ts = getGitMtimeIso(path);
        if (ts !== null && (best === null || ts > best)) {
            best = ts;
        }
    }
    return best;
}


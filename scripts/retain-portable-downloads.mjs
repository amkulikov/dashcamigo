import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareReleaseTags, isReleaseTag } from "../src/portable/release-tags.mjs";
import { readPortableArtifacts, stagePortableArtifacts } from "./_portable-artifacts.mjs";

const current = readPortableArtifacts(resolve(process.env.PORTABLE_MANIFEST ?? "dist-portable/manifest.json"));
const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required");
const dist = resolve(process.env.DIST_DIR ?? "dist");
const pages = JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    }),
);
if (!Array.isArray(pages)) throw new Error("invalid release listing");
let retained = 0;
for (const release of pages.flat()) {
    if (release.draft || release.prerelease || !isReleaseTag(release.tag_name)) continue;
    if (!Array.isArray(release.assets) || !release.assets.some((asset) => asset.name === "portable-manifest.json"))
        continue;
    if (compareReleaseTags(release.tag_name, current.version) > 0)
        throw new Error("a newer portable release already exists; refusing to roll back latest metadata");
    if (release.tag_name === current.version) continue;
    const directory = mkdtempSync(join(tmpdir(), "dashcamigo-portable-history-"));
    try {
        execFileSync(
            "gh",
            [
                "release",
                "download",
                release.tag_name,
                "--repo",
                repository,
                "--pattern",
                "portable-manifest.json",
                "--pattern",
                "dashcamigo-*.html",
                "--dir",
                directory,
            ],
            { stdio: "inherit" },
        );
        const manifestPath = join(directory, "portable-manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.version !== release.tag_name) throw new Error("historical portable release version mismatch");
        stagePortableArtifacts(manifestPath, dist, false);
        retained++;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
console.log(`portable downloads: retained ${retained} earlier releases`);

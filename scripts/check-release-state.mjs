// Fail before publishing any artifact, image tag or deployment.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { compareReleaseTags, isReleaseTag } from "../src/portable/release-tags.mjs";
import { git } from "./_release-tags.mjs";

const tag = process.env.GITHUB_REF_NAME;
const repository = process.env.GITHUB_REPOSITORY;
if (!isReleaseTag(tag)) throw new Error("invalid release tag");
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required");

const commit = git("rev-parse", "HEAD").trim();
if (git("rev-parse", `${tag}^{commit}`).trim() !== commit)
    throw new Error("release tag does not point at the checked-out commit");
git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
// Reject a rollback before deploying; promotion's fast-forward check is too late.
if (git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/release").trim())
    git("merge-base", "--is-ancestor", "refs/remotes/origin/release", commit);

function ghJson(...args) {
    return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const pages = ghJson("api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`);
if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("invalid release listing");
const releases = pages.flat();
if (releases.some((release) => release.tag_name === tag && !release.draft))
    throw new Error(`release ${tag} is already published (immutable) - cut a new tag`);
const previousTag = releases
    .filter((release) => !release.draft && !release.prerelease && isReleaseTag(release.tag_name))
    .map((release) => release.tag_name)
    .sort(compareReleaseTags)
    .at(-1);
if (previousTag && compareReleaseTags(previousTag, tag) >= 0)
    throw new Error(`release ${tag} does not follow published release ${previousTag}`);

const { workflow_runs: runs } = ghJson(
    "api",
    `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${commit}&per_page=1`,
);
const run = runs?.[0];
if (
    !run ||
    run.head_sha !== commit ||
    run.head_branch !== "main" ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
) {
    throw new Error(`successful CI on main is required for ${commit}; wait for CI or fix it before releasing`);
}

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `previous-tag=${previousTag ?? ""}\n`);
console.log(`release ${tag}: CI passed for ${commit}; previous published release: ${previousTag ?? "none"}`);

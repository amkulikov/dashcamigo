import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePortableManifest, PORTABLE_PRIMARY_ORIGIN } from "../src/portable/manifest.mjs";

const expected = parsePortableManifest(
    JSON.parse(readFileSync(resolve(process.env.PORTABLE_MANIFEST ?? "dist-portable/manifest.json"), "utf8")),
);
if (!expected) throw new Error("invalid expected portable manifest");
const origin = new URL(process.env.PORTABLE_SMOKE_ORIGIN ?? PORTABLE_PRIMARY_ORIGIN).origin;

async function request(path) {
    const response = await fetch(new URL(path, origin), {
        redirect: "error",
        headers: { Origin: "null" },
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`portable download returned HTTP ${response.status}`);
    return response;
}

const latest = await request("/downloads/portable/latest.json");
if (latest.headers.get("access-control-allow-origin") !== "*")
    throw new Error("portable metadata does not allow file-origin CORS");
if (
    !/max-age=0/.test(latest.headers.get("cache-control") ?? "") ||
    /immutable/.test(latest.headers.get("cache-control") ?? "")
)
    throw new Error("portable metadata cache policy does not revalidate");
const manifest = parsePortableManifest(await latest.json());
if (!manifest || JSON.stringify(manifest) !== JSON.stringify(expected))
    throw new Error("published portable metadata differs from the tested artifact");
for (const file of Object.values(manifest.files)) {
    const response = await request(file.path);
    if (response.headers.get("content-disposition") !== `attachment; filename="${file.filename}"`)
        throw new Error(`portable download filename mismatch: ${file.filename}`);
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (!cacheControl.includes("immutable") || !cacheControl.includes("no-transform"))
        throw new Error("portable download cache policy is missing immutable or no-transform");
    if (!response.headers.get("x-robots-tag")?.includes("noindex")) throw new Error("portable download is indexable");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(`published portable bytes differ from the release: ${file.filename}`);
}
console.log("portable downloads: live files, names, hashes, CORS and cache headers verified");

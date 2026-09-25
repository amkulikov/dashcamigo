import { resolve } from "node:path";
import { readPortableArtifacts } from "./_portable-artifacts.mjs";

const manifest = readPortableArtifacts(
    resolve(process.argv[2] ?? "dist-portable/manifest.json"),
    process.env.PORTABLE_ALLOW_DEV === "1",
);
console.log(`portable artifacts: ${Object.keys(manifest.files).length} files verified for ${manifest.version}`);

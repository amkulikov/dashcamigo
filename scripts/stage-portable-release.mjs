import { resolve } from "node:path";
import { stagePortableRelease } from "./_portable-artifacts.mjs";

const files = stagePortableRelease(
    resolve(process.argv[2] ?? "dist-portable/manifest.json"),
    resolve(process.argv[3] ?? "."),
    process.env.PORTABLE_ALLOW_DEV === "1",
);
console.log(`portable release: staged ${files.length} manifest-listed HTML assets`);

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, "scripts/encoder-test");

async function bundle(entry) {
    const build = await rolldown({ input: resolve(directory, entry), platform: "browser" });
    try {
        const { output } = await build.generate({ format: "iife", minify: true });
        if (output.length !== 1 || output[0].type !== "chunk" || output[0].imports.length) {
            throw new Error("encoder diagnostic must contain exactly one self-contained script per entry");
        }
        return output[0].code;
    } finally {
        await build.close();
    }
}

const [main, worker, template, manifest, license, libraryLicense] = await Promise.all([
    bundle("main.ts"),
    bundle("worker.ts"),
    readFile(resolve(directory, "template.html"), "utf8"),
    readFile(resolve(root, "node_modules/mediabunny/package.json"), "utf8"),
    readFile(resolve(root, "LICENSE"), "utf8"),
    readFile(resolve(root, "node_modules/mediabunny/LICENSE"), "utf8"),
]);
const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const replacements = {
    __MEDIABUNNY_VERSION__: JSON.parse(manifest).version,
    __WORKER_BASE64__: Buffer.from(worker).toString("base64"),
    __MAIN_SCRIPT__: main.replace(/<\/script/gi, "<\\/script"),
    __LICENSES__: escapeHtml(`dashcamigo\n\n${license}\n\nMediabunny\n\n${libraryLicense}`),
};
const html = template.replace(
    /__MEDIABUNNY_VERSION__|__WORKER_BASE64__|__MAIN_SCRIPT__|__LICENSES__/g,
    (key) => replacements[key],
);
const destination = resolve(root, "dist-diagnostics/dashcamigo-encoder-test.html");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
process.stdout.write(
    `${destination}\n${Buffer.byteLength(html).toLocaleString("en-US")} bytes; self-contained, no network dependencies\n`,
);

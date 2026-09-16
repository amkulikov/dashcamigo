#!/usr/bin/env node
// Regenerate the local contrast atlas from the immutable OpenFreeMap sprite.
// Chromium supplies PNG decoding/encoding; no image-processing dependency is needed.

import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { MAP_SDF_ICONS } from "./_map-style-palettes.mjs";

const SOURCE = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm";
const OUTPUT = new URL("../public/styles/sprite/", import.meta.url);

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`sprite download failed: ${response.status} ${url}`);
    return Buffer.from(await response.arrayBuffer());
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
    const page = await browser.newPage();
    for (const suffix of ["", "@2x"]) {
        const [json, png] = await Promise.all([
            download(`${SOURCE}${suffix}.json`),
            download(`${SOURCE}${suffix}.png`),
        ]);
        const generated = await page.evaluate(
            async ({ entries, encoded, names }) => {
                const image = new Image();
                image.src = `data:image/png;base64,${encoded}`;
                await image.decode();
                const ratio = entries[names[0]].pixelRatio;
                const padding = 3 * ratio;
                const rowHeight = Math.max(...names.map((name) => entries[name].height)) + padding * 2;
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height + rowHeight;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(image, 0, 0);
                let atlasX = 0;
                for (const name of names) {
                    const icon = entries[name];
                    const source = ctx.getImageData(icon.x, icon.y, icon.width, icon.height);
                    const width = icon.width + padding * 2;
                    const height = icon.height + padding * 2;
                    const alpha = new Float64Array(width * height);
                    for (let y = 0; y < icon.height; y++) {
                        for (let x = 0; x < icon.width; x++) {
                            alpha[(y + padding) * width + x + padding] =
                                source.data[(y * icon.width + x) * 4 + 3] / 255;
                        }
                    }
                    const sdf = ctx.createImageData(width, height);
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            let outer = Infinity;
                            let inner = Infinity;
                            // Small icons make an exact distance search cheap. Partial
                            // alpha preserves the upstream antialiased boundary.
                            for (let sy = 0; sy < height; sy++) {
                                for (let sx = 0; sx < width; sx++) {
                                    const a = alpha[sy * width + sx];
                                    const distance = (x - sx) ** 2 + (y - sy) ** 2;
                                    if (a > 0) outer = Math.min(outer, distance + Math.max(0, 0.5 - a) ** 2);
                                    if (a < 1) inner = Math.min(inner, distance + Math.max(0, a - 0.5) ** 2);
                                }
                            }
                            const offset = (y * width + x) * 4;
                            sdf.data.fill(255, offset, offset + 3);
                            // MapLibre's SDF shader uses edge=0.75 and radius=8.
                            sdf.data[offset + 3] = 255 * (0.75 - (Math.sqrt(outer) - Math.sqrt(inner)) / (8 * ratio));
                        }
                    }
                    ctx.putImageData(sdf, atlasX, image.height);
                    entries[name] = { ...icon, x: atlasX, y: image.height, width, height, sdf: true };
                    atlasX += width;
                }
                return { entries, png: canvas.toDataURL().split(",")[1] };
            },
            { entries: JSON.parse(json.toString()), encoded: png.toString("base64"), names: MAP_SDF_ICONS },
        );
        await writeFile(new URL(`sprite${suffix}.json`, OUTPUT), `${JSON.stringify(generated.entries)}\n`);
        await writeFile(new URL(`sprite${suffix}.png`, OUTPUT), Buffer.from(generated.png, "base64"));
    }
    const license = await download("https://raw.githubusercontent.com/hyperknot/openfreemap-styles/main/LICENSE.md");
    await writeFile(new URL("LICENSE.txt", OUTPUT), license);
} finally {
    await browser.close();
}

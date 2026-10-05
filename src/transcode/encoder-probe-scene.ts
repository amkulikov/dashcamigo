/** A fixed moving texture makes bitrate comparisons use identical, nontrivial input. */
export function createEncoderProbeScene(
    width: number,
    height: number,
): { canvas: OffscreenCanvas; draw: (seconds: number) => void } {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("canvas context unavailable");
    const tile = new OffscreenCanvas(512, 512);
    const tileContext = tile.getContext("2d", { alpha: false });
    if (!tileContext) throw new Error("texture context unavailable");
    const pixels = tileContext.createImageData(512, 512);
    let seed = 0x4d595df4;
    for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = (seed >>> 26) - 32;
            const base = 115 + 45 * Math.sin(x / 11) * Math.cos(y / 17);
            const offset = (y * 512 + x) * 4;
            pixels.data[offset] = base + noise;
            pixels.data[offset + 1] = base + noise + 24;
            pixels.data[offset + 2] = base + noise - 16;
            pixels.data[offset + 3] = 255;
        }
    }
    tileContext.putImageData(pixels, 0, 0);
    const pattern = context.createPattern(tile, "repeat");
    if (!pattern) throw new Error("texture pattern unavailable");
    return {
        canvas,
        draw(seconds) {
            context.save();
            context.translate(-Math.round(seconds * 137) % 512, -Math.round(seconds * 83) % 512);
            context.fillStyle = pattern;
            context.fillRect(0, 0, width + 512, height + 512);
            context.restore();
            for (let i = 0; i < 24; i++) {
                const x = ((i * 179 + seconds * (70 + i * 5)) % (width + 220)) - 220;
                const y = ((i * 113 + seconds * (30 + i * 3)) % (height + 120)) - 120;
                context.fillStyle = `hsl(${i * 47} 65% 50% / 0.8)`;
                context.fillRect(x, y, 160, 90);
                context.strokeStyle = "#fff";
                context.lineWidth = 2;
                context.strokeRect(x, y, 160, 90);
            }
            context.fillStyle = "#102030";
            context.fillRect(0, height - 90, width, 90);
            // Avoid font/platform differences: the progress marker is entirely geometry.
            context.fillStyle = "#71e0bb";
            context.fillRect(24, height - 60, Math.round((seconds / 5) * (width - 48)), 30);
        },
    };
}

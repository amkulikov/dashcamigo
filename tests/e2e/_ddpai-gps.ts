import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SAMPLE_NOGPS } from "./_fixtures.js";

const fixtureRoot = path.resolve("src/parsers/__fixtures__/ddpai-gps");

export function ddpaiFixtureFolder(withGps: boolean, hasLayout = true): string {
    const root = mkdtempSync(path.join(tmpdir(), "everydashcam-ddpai-"));
    const videoDir = hasLayout ? path.join(root, "DCIM/200video/front") : root;
    mkdirSync(videoDir, { recursive: true });
    const sample = readdirSync(SAMPLE_NOGPS).find((name) => /\.mp4$/i.test(name));
    if (!sample) throw new Error("missing no-GPS video fixture");
    copyFileSync(path.join(SAMPLE_NOGPS, sample), path.join(videoDir, "20261006163238_0057.mp4"));
    if (withGps) {
        const gpsDir = path.join(root, "DCIM/203gps/tar");
        mkdirSync(gpsDir, { recursive: true });
        copyFileSync(path.join(fixtureRoot, "real-anonymized.git"), path.join(gpsDir, "20261006163238_0057.git"));
    }
    return root;
}

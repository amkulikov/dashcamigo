import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { LANGS } from "./languages.js";

const html = readFileSync("index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "");
const source = html.match(/^\s*<script id="dc-bootstrap">([\s\S]*?)<\/script>/m)?.[1];
if (!source) throw new Error("missing language bootstrap");
const script = source.replace("__DC_LANGS__", JSON.stringify(LANGS.map(({ code }) => code)));

function bootstrap(stored: Record<string, string>, pathname = "/", language = "en-US", blocked = false) {
    let destination: string | null = null;
    const documentElement = {
        lang: "en",
        classList: { add() {}, remove() {} },
        hasAttribute: () => false,
    };
    runInNewContext(script, {
        document: { documentElement },
        location: {
            pathname,
            search: "?keep=1",
            hash: "#notes",
            replace: (url: string) => {
                destination = url;
            },
        },
        localStorage: {
            getItem: (key: string) => {
                if (blocked) throw new Error("blocked");
                return stored[key] ?? null;
            },
        },
        navigator: { language },
        window: {},
        addEventListener() {},
        setTimeout() {},
    });
    return { destination, lang: documentElement.lang };
}

describe("language bootstrap", () => {
    it("uses the saved preference before loading any modules", () => {
        expect(bootstrap({ "everydashcam:lang": "ru" }).destination).toBe("/ru/?keep=1#notes");
    });

    it("ignores the previous namespace", () => {
        expect(bootstrap({ "dashcamigo:lang": "fr", "everydashcam:lang": "ru" }).destination).toBe("/ru/?keep=1#notes");
    });

    it("preserves explicit language routes over saved preferences", () => {
        expect(bootstrap({ "dashcamigo:lang": "ru", "everydashcam:lang": "de" }, "/fr/")).toEqual({ destination: null, lang: "fr" });
    });

    it("falls back to the browser language when storage is denied", () => {
        expect(bootstrap({}, "/", "ja-JP", true).destination).toBe("/ja/?keep=1#notes");
    });
});

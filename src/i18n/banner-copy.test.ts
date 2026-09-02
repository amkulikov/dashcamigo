// Parity guard for BANNER_COPY. The lang-suggestion banner needs its 4 strings
// in EVERY locale (it offers a switch in the suggested language), but a
// prerendered page carries only the active locale's dictionary. BANNER_COPY
// duplicates those 4 keys × 10 locales so the banner does not import all 10
// full dictionaries. This test pins that the duplicate stays in sync with the
// dictionaries (the source of truth) - drift here fails CI, not production.

import { describe, expect, it } from "vitest";

import { BANNER_COPY, type BannerCopyEntry } from "./banner-copy.js";
import { DEV_DICTS } from "./dev-dicts.js";
import type { Lang } from "./index.js";

// The 4 banner fields and the dictionary key each mirrors.
const FIELD_TO_KEY: Record<keyof BannerCopyEntry, "langBanner.message" | "langBanner.open" | "langBanner.dismiss" | "langBanner.regionLabel"> = {
    message: "langBanner.message",
    open: "langBanner.open",
    dismiss: "langBanner.dismiss",
    regionLabel: "langBanner.regionLabel",
};

describe("BANNER_COPY parity with dictionaries", () => {
    const langs = Object.keys(DEV_DICTS) as Lang[];

    it("covers every locale", () => {
        expect(Object.keys(BANNER_COPY).sort()).toEqual(langs.sort());
    });

    for (const lang of Object.keys(DEV_DICTS) as Lang[]) {
        for (const [field, key] of Object.entries(FIELD_TO_KEY) as [keyof BannerCopyEntry, keyof (typeof DEV_DICTS)[Lang]][]) {
            it(`${lang}.${field} matches dictionary ${key}`, () => {
                expect(BANNER_COPY[lang][field]).toBe(DEV_DICTS[lang][key]);
            });
        }
    }
});

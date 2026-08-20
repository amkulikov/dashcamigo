import { describe, expect, it } from "vitest";
import { PRIMARY_SITE_ORIGIN, canonicalLocaleUrl, canonicalProfileForLocale, localeNeedsYandexNoIndex, mirrorRootLocaleSegment, parseDeploymentProfile, profileOwnsLocale, profileRequiresGlobalNoIndex, resolveSeoDeploymentContext, type SeoDeploymentContext } from "../../vite-plugins/deployment-profile.js";
import { getSeoLocaleByLang } from "./seo-config.js";

const mirror = {
    origin: "https://mirror.example.test",
    localeSegments: ["de"],
    rootLocaleSegment: "de",
} as const;
const primaryBefore: SeoDeploymentContext = { profile: "primary", seoCutover: false, mirror };
const mirrorBefore: SeoDeploymentContext = { profile: "mirror", seoCutover: false, mirror };
const primaryAfter: SeoDeploymentContext = { profile: "primary", seoCutover: true, mirror };
const mirrorAfter: SeoDeploymentContext = { profile: "mirror", seoCutover: true, mirror };
const en = getSeoLocaleByLang("en")!;
const mirrored = getSeoLocaleByLang("de")!;

describe("deployment profile", () => {
    it("defaults to primary and rejects unknown values", () => {
        expect(parseDeploymentProfile(undefined)).toBe("primary");
        expect(parseDeploymentProfile("primary")).toBe("primary");
        expect(parseDeploymentProfile("mirror")).toBe("mirror");
        expect(() => parseDeploymentProfile("regional")).toThrow(/DEPLOYMENT_PROFILE/);
    });

    it("reads mirror ownership only from build-time JSON", () => {
        expect(
            resolveSeoDeploymentContext({
                DEPLOYMENT_PROFILE: "mirror",
                SEO_CUTOVER: "1",
                SEO_MIRROR_CONFIG: JSON.stringify(mirror),
            }),
        ).toEqual(mirrorAfter);
        expect(() => resolveSeoDeploymentContext({ DEPLOYMENT_PROFILE: "mirror" })).toThrow(/SEO_MIRROR_CONFIG/);
    });

    it("rejects malformed origins, unknown locales and ambiguous cutover values", () => {
        expect(() =>
            resolveSeoDeploymentContext({
                DEPLOYMENT_PROFILE: "mirror",
                SEO_MIRROR_CONFIG: JSON.stringify({ ...mirror, origin: "https://mirror.example.test/path" }),
            }),
        ).toThrow(/origin/);
        expect(() =>
            resolveSeoDeploymentContext({
                DEPLOYMENT_PROFILE: "mirror",
                SEO_MIRROR_CONFIG: JSON.stringify({
                    ...mirror,
                    localeSegments: ["not-a-shipped-locale"],
                    rootLocaleSegment: "not-a-shipped-locale",
                }),
            }),
        ).toThrow(/unknown URL segments/);
        expect(() => resolveSeoDeploymentContext({ SEO_CUTOVER: "yes" })).toThrow(/SEO_CUTOVER/);
    });

    it("keeps every canonical on primary until cutover", () => {
        expect(canonicalLocaleUrl(en, "", mirrorBefore)).toBe(`${PRIMARY_SITE_ORIGIN}/en/`);
        expect(canonicalLocaleUrl(mirrored, "cameras/70mai/", mirrorBefore)).toBe(`${PRIMARY_SITE_ORIGIN}/de/cameras/70mai/`);
        expect(profileRequiresGlobalNoIndex(mirrorBefore)).toBe(true);
        expect(profileRequiresGlobalNoIndex(primaryBefore)).toBe(false);
    });

    it("moves only configured locale segments after cutover", () => {
        expect(canonicalLocaleUrl(mirrored, "", primaryAfter)).toBe(`${mirror.origin}/de/`);
        expect(canonicalLocaleUrl(en, "", mirrorAfter)).toBe(`${PRIMARY_SITE_ORIGIN}/en/`);
        expect(canonicalProfileForLocale(mirrored, primaryAfter)).toBe("mirror");
        expect(canonicalProfileForLocale(en, mirrorAfter)).toBe("primary");
    });

    it("assigns reciprocal Yandex noindex only to the duplicate profile", () => {
        expect(profileOwnsLocale(mirrored, primaryAfter)).toBe(false);
        expect(localeNeedsYandexNoIndex(mirrored, primaryAfter)).toBe(true);
        expect(localeNeedsYandexNoIndex(en, primaryAfter)).toBe(false);
        expect(profileOwnsLocale(mirrored, mirrorAfter)).toBe(true);
        expect(localeNeedsYandexNoIndex(mirrored, mirrorAfter)).toBe(false);
        expect(localeNeedsYandexNoIndex(en, mirrorAfter)).toBe(true);
    });

    it("gets the mirror root locale from the private build config", () => {
        expect(mirrorRootLocaleSegment(mirrorAfter)).toBe("de");
    });
});

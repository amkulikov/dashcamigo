// Generic build-time deployment profile and SEO ownership policy.
//
// The public repository knows only that an optional mirror may own a subset
// of locale URL segments. Its hostname, locale set and root fallback arrive in
// SEO_MIRROR_CONFIG at build time. Runtime language selection deliberately
// does not import this module and always stays on the current hostname.

import { getIndexableSeoLocales, type SeoLocale } from "../src/i18n/seo-config.js";

export const PRIMARY_SITE_ORIGIN = "https://dashcamigo.app";
export const LARGE_IMAGE_PREVIEW_META = '<meta name="robots" content="max-image-preview:large">';

export type DeploymentProfile = "primary" | "mirror";

export interface SeoMirrorConfig {
    origin: string;
    localeSegments: ReadonlyArray<string>;
    rootLocaleSegment: string;
}

export interface SeoDeploymentContext {
    profile: DeploymentProfile;
    seoCutover: boolean;
    mirror: SeoMirrorConfig | null;
}

type BuildEnv = Readonly<Record<string, string | undefined>>;

function parseEnabled(name: string, value: string | undefined): boolean {
    if (value === undefined || value === "" || value === "0" || value === "false") return false;
    if (value === "1" || value === "true") return true;
    throw new Error(`${name} must be 0, 1, false or true, got ${JSON.stringify(value)}`);
}

export function parseDeploymentProfile(value: string | undefined): DeploymentProfile {
    if (value === undefined || value === "" || value === "primary") return "primary";
    if (value === "mirror") return "mirror";
    throw new Error(`DEPLOYMENT_PROFILE must be "primary" or "mirror", got ${JSON.stringify(value)}`);
}

function parseMirrorConfig(raw: string | undefined): SeoMirrorConfig | null {
    if (!raw) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error("SEO_MIRROR_CONFIG must be valid JSON");
    }
    if (!value || typeof value !== "object") throw new Error("SEO_MIRROR_CONFIG must be a JSON object");
    const candidate = value as Record<string, unknown>;
    const rawOrigin = typeof candidate.origin === "string" ? candidate.origin.trim() : "";
    let parsedOrigin: URL;
    try {
        parsedOrigin = new URL(rawOrigin);
    } catch {
        throw new Error("SEO_MIRROR_CONFIG.origin must be an HTTPS origin without a path");
    }
    if (
        parsedOrigin.protocol !== "https:" ||
        parsedOrigin.pathname !== "/" ||
        parsedOrigin.search ||
        parsedOrigin.hash ||
        parsedOrigin.username ||
        parsedOrigin.password
    ) {
        throw new Error("SEO_MIRROR_CONFIG.origin must be an HTTPS origin without a path");
    }
    const origin = parsedOrigin.origin;
    if (origin === PRIMARY_SITE_ORIGIN) {
        throw new Error("SEO_MIRROR_CONFIG.origin must differ from the primary origin");
    }
    const localeSegments = candidate.localeSegments;
    const rootLocaleSegment = candidate.rootLocaleSegment;
    if (
        !Array.isArray(localeSegments) ||
        localeSegments.length === 0 ||
        !localeSegments.every((segment) => typeof segment === "string" && /^[a-z0-9-]+$/.test(segment))
    ) {
        throw new Error("SEO_MIRROR_CONFIG.localeSegments must be a non-empty array of URL segments");
    }
    if (typeof rootLocaleSegment !== "string" || !localeSegments.includes(rootLocaleSegment)) {
        throw new Error("SEO_MIRROR_CONFIG.rootLocaleSegment must belong to localeSegments");
    }
    const uniqueLocaleSegments = [...new Set(localeSegments)];
    const knownLocaleSegments = new Set(getIndexableSeoLocales().map((locale) => locale.urlSegment));
    const unknownLocaleSegments = uniqueLocaleSegments.filter((segment) => !knownLocaleSegments.has(segment));
    if (unknownLocaleSegments.length > 0) {
        throw new Error(
            `SEO_MIRROR_CONFIG.localeSegments contains unknown URL segments: ${unknownLocaleSegments.join(", ")}`,
        );
    }
    return { origin, localeSegments: uniqueLocaleSegments, rootLocaleSegment };
}

export function resolveSeoDeploymentContext(env: BuildEnv = process.env): SeoDeploymentContext {
    const profile = parseDeploymentProfile(env.DEPLOYMENT_PROFILE);
    const seoCutover = parseEnabled("SEO_CUTOVER", env.SEO_CUTOVER);
    const mirror = parseMirrorConfig(env.SEO_MIRROR_CONFIG);
    if ((profile === "mirror" || seoCutover) && !mirror) {
        throw new Error("SEO_MIRROR_CONFIG is required for a mirror build or SEO cutover");
    }
    return { profile, seoCutover, mirror };
}

export function currentSiteOrigin(context: SeoDeploymentContext = resolveSeoDeploymentContext()): string {
    if (context.profile === "primary") return PRIMARY_SITE_ORIGIN;
    if (!context.mirror) throw new Error("mirror profile has no SEO mirror configuration");
    return context.mirror.origin;
}

export function canonicalProfileForLocale(
    locale: Pick<SeoLocale, "urlSegment">,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): DeploymentProfile {
    const mirrorOwns = context.seoCutover && context.mirror?.localeSegments.includes(locale.urlSegment);
    return mirrorOwns ? "mirror" : "primary";
}

export function canonicalOriginForLocale(
    locale: Pick<SeoLocale, "urlSegment">,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): string {
    return canonicalProfileForLocale(locale, context) === "mirror" ? context.mirror!.origin : PRIMARY_SITE_ORIGIN;
}

/** Canonical URL for one localized route. `tail` is relative to /<lang>/. */
export function canonicalLocaleUrl(
    locale: Pick<SeoLocale, "urlSegment">,
    tail = "",
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): string {
    const cleanTail = tail.replace(/^\/+/, "");
    return `${canonicalOriginForLocale(locale, context)}/${locale.urlSegment}/${cleanTail}`;
}

export function profileOwnsLocale(
    locale: Pick<SeoLocale, "urlSegment">,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): boolean {
    return canonicalProfileForLocale(locale, context) === context.profile;
}

/** The mirror is a crawlable noindex canary until explicit SEO cutover. */
export function profileRequiresGlobalNoIndex(
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): boolean {
    return context.profile === "mirror" && !context.seoCutover;
}

/** Yandex-specific duplicate suppression after cutover; Google still sees canonical. */
export function localeNeedsYandexNoIndex(
    locale: Pick<SeoLocale, "urlSegment">,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): boolean {
    return context.seoCutover && !profileOwnsLocale(locale, context);
}

export function searchIndexingMeta(
    locale: Pick<SeoLocale, "urlSegment">,
    globalNoIndex: boolean,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): string {
    if (globalNoIndex) return '<meta name="robots" content="noindex, nofollow">';
    return (
        LARGE_IMAGE_PREVIEW_META +
        (localeNeedsYandexNoIndex(locale, context) ? '<meta name="yandex" content="noindex">' : "")
    );
}

export function mirrorRootLocaleSegment(context: SeoDeploymentContext = resolveSeoDeploymentContext()): string {
    if (!context.mirror) throw new Error("mirror root locale requested without SEO_MIRROR_CONFIG");
    return context.mirror.rootLocaleSegment;
}

export function profileOwnsCanonicalUrl(
    url: string,
    context: SeoDeploymentContext = resolveSeoDeploymentContext(),
): boolean {
    const origin = currentSiteOrigin(context);
    return url === origin || url.startsWith(`${origin}/`);
}

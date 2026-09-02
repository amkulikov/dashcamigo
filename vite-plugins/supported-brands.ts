import type { Lang } from "../src/i18n/index.js";

// SEO-facing list of supported dashcam brands. Pure SEO surface - this is
// what we want crawlers, AI agents, and SERP rich snippets to see when they
// ask "which dashcams does dashcamigo support?".
//
// Why a separate list from the parser registry:
//  - Parser code (src/parsers/) is the technical reality - which byte formats
//    and filename heuristics actually work. That list grows by extraction
//    technique, not by camera brand.
//  - This list is the public-facing brand inventory. It's the answer to "is
//    my dashcam supported?" - which is a different question from "which
//    primitives do we ship". Branding, ordering and presence here is a
//    marketing/SEO decision, not a code decision.
//  - Multiple brands can share a parser (Viofo / Vantrue / Akaso all on
//    Novatek), and one brand can be supported across several parsers
//    (BlackVue X-series embedded vs legacy .gps sidecar). The 1-to-N mapping
//    between brands and parsers makes auto-deriving this list error-prone.
//
// Used by:
//  - vite-plugins/seo-prerender.ts: WebApplication JSON-LD featureList (rich
//    snippet), FAQ JSON-LD landing-brand mention.
//  - vite-plugins/llms-txt.ts: opening summary of dist/llms.txt.
//  - vite-plugins/vendor-pages.ts: subset with hasLandingPage=true gets the
//    dedicated /cameras/<slug>/ pages (high-volume search terms).
//
// Adding a brand: append below. Set hasLandingPage=true ONLY if there's a
// matching VendorContent in vendor-pages.ts ready to render. Order is meant
// to be importance-descending (landing-page brands first), not alphabetical - SERP
// scanners pick up the early items more often.

// Discriminated union: when hasLandingPage=true the slug is mandatory, when
// false it must NOT be set. The old shape ({ slug?, hasLandingPage: boolean })
// allowed { hasLandingPage: true } without a slug to compile - that entry then
// got silently filtered out by getLandingBrands(), and no landing page was
// rendered for it. The union below makes the invariant typechecked.
export type SupportedBrand =
    | { displayName: string; hasLandingPage: true; slug: VendorSlug; locales: readonly Lang[] }
    | { displayName: string; hasLandingPage: false; slug?: never };

// VendorSlug enumerates the brands that have a dedicated landing page. Used
// as a type narrowing in vendor-pages.ts where the VendorContent records are
// keyed by slug.
export type VendorSlug =
    | "70mai"
    | "viofo"
    | "blackvue"
    | "gopro"
    | "garmin"
    | "vantrue"
    | "thinkware"
    | "nextbase"
    | "redtiger"
    | "navitel"
    | "mio"
    | "navman"
    | "fitcamx";

// A new product locale must not silently multiply every vendor page. The
// rollout list is explicit per brand so only useful, reviewed translations
// enter the sitemap and hreflang graph.
const ALL_VENDOR_LOCALES = ["en", "ru", "de", "es", "fr", "pl", "pt", "zh", "ja", "ko"] as const satisfies readonly Lang[];
const ALL_EXCEPT_PT = ["en", "ru", "de", "es", "fr", "pl", "zh", "ja", "ko"] as const satisfies readonly Lang[];

export const SUPPORTED_BRANDS: ReadonlyArray<SupportedBrand> = [
    { displayName: "70mai", slug: "70mai", hasLandingPage: true, locales: ALL_VENDOR_LOCALES },
    { displayName: "Viofo", slug: "viofo", hasLandingPage: true, locales: ALL_VENDOR_LOCALES },
    { displayName: "BlackVue", slug: "blackvue", hasLandingPage: true, locales: ALL_EXCEPT_PT },
    { displayName: "GoPro", slug: "gopro", hasLandingPage: true, locales: ALL_VENDOR_LOCALES },
    {
        displayName: "Garmin",
        slug: "garmin",
        hasLandingPage: true,
        locales: ["en", "ru", "de", "es", "fr", "pl", "pt", "zh", "ja"],
    },
    { displayName: "Vantrue", slug: "vantrue", hasLandingPage: true, locales: ALL_EXCEPT_PT },
    { displayName: "Thinkware", slug: "thinkware", hasLandingPage: true, locales: ALL_EXCEPT_PT },
    {
        displayName: "Nextbase",
        slug: "nextbase",
        hasLandingPage: true,
        locales: ["en", "ru", "de", "fr", "pl"],
    },
    {
        displayName: "REDTIGER",
        slug: "redtiger",
        hasLandingPage: true,
        locales: ["en", "ru", "de", "es"],
    },
    {
        displayName: "NAVITEL",
        slug: "navitel",
        hasLandingPage: true,
        locales: ["en", "ru", "pl"],
    },
    {
        displayName: "Mio MiVue",
        slug: "mio",
        hasLandingPage: true,
        locales: ["en", "ru", "de", "fr", "pl"],
    },
    {
        displayName: "Navman MiVue",
        slug: "navman",
        hasLandingPage: true,
        locales: ["en", "ru"],
    },
    {
        displayName: "FITCAMX",
        slug: "fitcamx",
        hasLandingPage: true,
        locales: ["en", "ru", "de", "pl"],
    },
    { displayName: "Vueroid", hasLandingPage: false },
    { displayName: "Botslab", hasLandingPage: false },
    { displayName: "Neoline", hasLandingPage: false },
    { displayName: "Juscar", hasLandingPage: false },
    { displayName: "Escort", hasLandingPage: false },
    { displayName: "Carcam", hasLandingPage: false },
    { displayName: "Beferich", hasLandingPage: false },
    { displayName: "DATAKAM", hasLandingPage: false },
    { displayName: "2E Drive", hasLandingPage: false },
    { displayName: "Aspiring", hasLandingPage: false },
    { displayName: "Sony", hasLandingPage: false },
    { displayName: "JOOYFACT", hasLandingPage: false },
    { displayName: "HP", hasLandingPage: false },
    { displayName: "SilverStone F1", hasLandingPage: false },
    { displayName: "Roadgid", hasLandingPage: false },
    { displayName: "iBOX", hasLandingPage: false },
];

// Brands with a dedicated landing page. Used by vendor-pages.ts to enumerate
// what to render, and by buildFaqJsonLd as the "top vendors" shortlist in
// the homepage FAQ answer (full SUPPORTED_BRANDS is too long for its linked prefix).
// The discriminated union on SupportedBrand guarantees `slug` is present in
// the true branch.
export function getLandingBrands(): ReadonlyArray<SupportedBrand & { hasLandingPage: true }> {
    return SUPPORTED_BRANDS.filter(
        (b): b is SupportedBrand & { hasLandingPage: true } => b.hasLandingPage,
    );
}

// Comma-separated list of all brand display names. Used in JSON-LD
// featureList - "X, Y, Z vendor support" - so Google's rich snippet for
// dashcamigo lists every brand the SEO surface promises to support.
export function getAllBrandsCommaSeparated(): string {
    return SUPPORTED_BRANDS.map((b) => b.displayName).join(", ");
}

// Comma-separated list of just the landing-page brands. Used in the homepage
// "which dashcams are supported?" answer - kept short for SERP
// readability ("the long tail" is acknowledged in the answer copy through
// the locale-specific landing.faq.a2.after key).
export function getLandingBrandsCommaSeparated(): string {
    return getLandingBrands()
        .map((b) => b.displayName)
        .join(", ");
}

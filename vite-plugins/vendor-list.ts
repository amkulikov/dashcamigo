// The landing-page subset of SUPPORTED_BRANDS in the original vendor-list
// shape (slug + displayName). New code should import directly from
// ./supported-brands.js - this file exists to keep the import path stable.

import { getLandingBrands } from "./supported-brands.js";

// Brands with a dedicated /cameras/<slug>/ landing page. Same shape as the
// pre-refactor list (slug + displayName), derived from SUPPORTED_BRANDS.
export const VENDOR_LIST = getLandingBrands().map((b) => ({
    slug: b.slug,
    displayName: b.displayName,
    locales: b.locales,
}));

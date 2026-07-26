// Dev-only dictionary map. In `vite dev` the prerender does not run, so no
// dictionary is baked into the served HTML - the runtime needs another source,
// and the served locale can be any supported Lang (localStorage / navigator).
// This module imports all of them.
//
// It is referenced EXCLUSIVELY from the `import.meta.env.DEV` branch in
// index.ts. In a production build that constant folds to `false`, the branch is
// dead code, and this module (with its per-locale dictionary imports) is
// tree-shaken out entirely - the dictionaries never ship in the bundle. See
// index.ts.

import type { Lang } from "./index.js";
import type { I18nKey } from "./keys.js";

import { deDict } from "./de.js";
import { enDict } from "./en.js";
import { esDict } from "./es.js";
import { frDict } from "./fr.js";
import { jaDict } from "./ja.js";
import { koDict } from "./ko.js";
import { plDict } from "./pl.js";
import { ptDict } from "./pt.js";
import { ruDict } from "./ru.js";
import { zhDict } from "./zh.js";

export const DEV_DICTS: Record<Lang, Record<I18nKey, string>> = {
    ru: ruDict,
    en: enDict,
    de: deDict,
    es: esDict,
    pt: ptDict,
    fr: frDict,
    pl: plDict,
    zh: zhDict,
    ja: jaDict,
    ko: koDict,
};

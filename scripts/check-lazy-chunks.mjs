// Build-time guard for the T9 lazy-loading optimization.
//
// T9 moved the heavy viewer libs (maplibre-gl ~1MB, chart.js ~170KB) off the
// landing critical path: they are dynamically import()-ed on first trip-open,
// so Rollup auto-splits them into async chunks that are NOT in the landing's
// eager <link rel="modulepreload"> set.
//
// The risk this guard defends against: that optimization is fragile to the
// BUNDLER, not our code. A Vite/Rollup bump, a dependency change, or a stray
// static import can make Rollup co-locate or eagerly link those libs again,
// silently re-bloating the landing page (a Core Web Vitals / SEO regression
// nobody notices until a Lighthouse audit). This script turns that silent
// revert into a LOUD build failure.
//
// Why a byte budget instead of name/signature matching: it measures the actual
// user-facing property (how much vendor JS the landing eagerly downloads) and
// is completely toolchain-agnostic. A maplibre version bump that changes the
// (still-lazy) chunk's size does not trip it - only the lib reappearing in the
// eager set does. No dependence on internal chunk names or minified signatures,
// which is exactly the brittleness we are trying to avoid.
//
// Wired into `npm run build` (after `vite build`) and thus `test:e2e` too.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
// Any prerendered locale carries the same chunk graph; /en/ is representative.
const ENTRY_HTML = resolve(DIST, "en/index.html");

// Budget for the SUM of eagerly preloaded vendor chunks (the <link
// rel=modulepreload> set, which excludes the entry <script> itself).
//
// Current legit eager vendors: intl-messageformat (~34KB, needed for the first
// render's translations) + native-file-system-adapter (~11KB) = ~45KB. maplibre,
// chart.js and mediabunny are all lazy now (T9) and must NOT appear here.
//
// The budget sits below "current + chart.js" (~45 + 167 = 212KB): if any of the
// three lazy libs (chart ~167KB, mediabunny ~239KB, maplibre ~1MB) leaks back
// into the eager set, the sum blows past it. ~75KB of headroom for i18n/fsa
// growth before a deliberate bump is needed.
const EAGER_VENDOR_BUDGET_BYTES = 120 * 1024;

// Budget for ALL eager JS the landing downloads: the entry <script src> chunk
// PLUS the modulepreload set. The vendor budget above is blind to the entry
// chunk itself - a static value import of a heavy lib from any eager module
// gets co-located INTO the entry (not a separate preload link), so it never
// shows up as a modulepreload and the vendor check never sees it grow. The
// smallest guarded lib (chart.js ~165KB) leaking back overshoots this budget,
// while the headroom above the current entry+preload sum absorbs normal app
// growth before a deliberate bump is needed. Current staging total is ~716KB
// after the recording-folder notes safety UI; 728KB leaves useful app-growth
// headroom while remaining far below a heavy-lib leak.
const EAGER_TOTAL_JS_BUDGET_BYTES = 728 * 1024;

function fail(msg) {
    console.error(`\n[check-lazy-chunks] FAIL: ${msg}\n`);
    process.exit(1);
}

let html;
try {
    html = readFileSync(ENTRY_HTML, "utf8");
} catch {
    fail(`could not read ${ENTRY_HTML} - run \`npm run build\` first (this guard runs post-build)`);
}

// Collect modulepreload hrefs (attribute order is not guaranteed, so match the
// whole tag then pull href). The entry itself is a <script src>, not a
// modulepreload, so it is naturally excluded from this sum.
const preloadTags = html.match(/<link\b[^>]*\bmodulepreload\b[^>]*>/gi) ?? [];
const hrefs = preloadTags
    .map((tag) => tag.match(/\bhref="([^"]+\.js)"/i)?.[1])
    .filter((href) => typeof href === "string");

if (hrefs.length === 0) {
    // Not necessarily wrong (Vite could inline everything), but for this app it
    // means the parse broke or the build shape changed - worth a loud stop.
    fail("found zero modulepreload <link> chunks in dist/en/index.html - the build shape changed; re-check this guard");
}

let total = 0;
const breakdown = [];
for (const href of hrefs) {
    const filePath = resolve(DIST, href.replace(/^\//, ""));
    let size = 0;
    try {
        size = statSync(filePath).size;
    } catch {
        fail(`modulepreload references ${href} but the file is missing in dist`);
    }
    total += size;
    breakdown.push({ href, size });
}

breakdown.sort((a, b) => b.size - a.size);
const kib = (n) => `${(n / 1024).toFixed(1)}KB`;
const report = breakdown.map((b) => `    ${kib(b.size).padStart(9)}  ${b.href}`).join("\n");

if (total > EAGER_VENDOR_BUDGET_BYTES) {
    fail(
        `landing eagerly preloads ${kib(total)} of vendor JS, over the ${kib(EAGER_VENDOR_BUDGET_BYTES)} budget.\n` +
            `A heavy lib likely leaked back onto the landing critical path (T9 regression).\n` +
            `Eager preload set:\n${report}\n\n` +
            `If this is an intentional change, adjust EAGER_VENDOR_BUDGET_BYTES in scripts/check-lazy-chunks.mjs.`,
    );
}

// Entry chunk (the <script type="module" src=...> tag) + the preload set = the
// full eager JS payload. See EAGER_TOTAL_JS_BUDGET_BYTES for why the entry must
// be measured too, not just the preload links.
const entryHref = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+\.js)"/i)?.[1];
if (!entryHref) {
    fail("could not find the module entry <script src> in dist/en/index.html - the build shape changed; re-check this guard");
}
let entrySize = 0;
try {
    entrySize = statSync(resolve(DIST, entryHref.replace(/^\//, ""))).size;
} catch {
    fail(`entry script references ${entryHref} but the file is missing in dist`);
}
const eagerTotal = total + entrySize;
if (eagerTotal > EAGER_TOTAL_JS_BUDGET_BYTES) {
    fail(
        `landing downloads ${kib(eagerTotal)} of eager JS (entry ${kib(entrySize)} + preloads ${kib(total)}), ` +
            `over the ${kib(EAGER_TOTAL_JS_BUDGET_BYTES)} budget.\n` +
            `A heavy lib (mediabunny / chart.js / maplibre / the parser primitives) likely got a static value\n` +
            `import from an eager module and was co-located into the entry chunk. Trace static import chains\n` +
            `from src/app.ts to the heavy module and break them with a dynamic import() at the call site.\n\n` +
            `If this is an intentional change, adjust EAGER_TOTAL_JS_BUDGET_BYTES in scripts/check-lazy-chunks.mjs.`,
    );
}

console.log(`[check-lazy-chunks] OK - landing eager vendor preload ${kib(total)} / ${kib(EAGER_VENDOR_BUDGET_BYTES)} budget`);
console.log(`[check-lazy-chunks] OK - landing eager JS total ${kib(eagerTotal)} (entry ${kib(entrySize)}) / ${kib(EAGER_TOTAL_JS_BUDGET_BYTES)} budget`);
console.log(report);

// Canonical form of a bundled program for cache revisions. Two bundles that
// behave the same must serialize the same even when the bundler that emitted
// them differs, because a revision change drops every user's cached parse
// results. A real behavior change must still change the output: erring the
// other way serves stale cached GPS.

import { parseSync } from "rolldown/utils";

// Fields that carry formatting, not behavior: source positions, and the
// literal spelling ("0x10" vs "16") whose value is kept in `value`.
const POSITION_KEYS = new Set(["start", "end", "range", "loc"]);

// rolldown resolves a name clash between concatenated modules by suffixing
// `$<n>`; the number depends on module order and bundler internals.
const DECONFLICT_SUFFIX_RE = /^(.*)\$\d+$/;

function isDroppedKey(node, key) {
    if (POSITION_KEYS.has(key)) return true;
    if (node.type === "Literal") {
        if (key === "raw") return true;
        // The `null` literal: its value is the payload, not an absent field.
        if (key === "value") return false;
    }
    // A null field means the same as an absent one in ESTree, and the parser
    // adds such optional fields to node types over time.
    return node[key] === null || node[key] === undefined;
}

function serialize(value, node, key, deconflicted) {
    if (Array.isArray(value)) return `[${value.map((item) => serialize(item, value, null, deconflicted)).join(",")}]`;
    // Tagged so Infinity/NaN do not collapse into JSON's "null".
    if (typeof value === "number") return `n:${String(value)}`;
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "string" && key === "name" && node?.type === "Identifier") {
        // Renumber in traversal order into a namespace a JS identifier cannot
        // spell. The mapping is one-to-one, so distinct bindings stay distinct.
        const match = DECONFLICT_SUFFIX_RE.exec(value);
        if (match) {
            let renamed = deconflicted.get(value);
            if (!renamed) {
                renamed = `${match[1]}$#${deconflicted.size}`;
                deconflicted.set(value, renamed);
            }
            return JSON.stringify(renamed);
        }
    }
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    // Sorted keys keep the output independent of the AST serializer's field order.
    const keys = Object.keys(value)
        .filter((childKey) => !isDroppedKey(value, childKey))
        .sort();
    return `{${keys.map((childKey) => `${JSON.stringify(childKey)}:${serialize(value[childKey], value, childKey, deconflicted)}`).join(",")}}`;
}

/**
 * Serializes the AST of an emitted ES module so that bundler output details
 * with no runtime meaning (comments and annotations, whitespace, redundant
 * parentheses, literal spelling, deconflict suffix numbers) do not affect the
 * result. Throws when `code` does not parse.
 */
export function canonicalProgram(fileName, code) {
    const { program, errors } = parseSync(fileName, code, {
        lang: "js",
        sourceType: "module",
        preserveParens: false,
    });
    if (errors.length > 0) throw new Error(`cannot parse bundled ${fileName}: ${errors[0].message}`);
    return serialize(program, null, null, new Map());
}

// Ignore formatting changes in bundled cache producers without hiding runtime
// changes: a false match serves stale cached GPS. Identifier spellings remain
// significant, including `$<n>` suffixes: they can name properties, imports,
// exports, or functions whose `.name` is observable.

import { parseSync } from "rolldown/utils";

// Fields that carry formatting, not behavior: source positions, and the
// literal spelling ("0x10" vs "16") whose value is kept in `value`.
const POSITION_KEYS = new Set(["start", "end", "range", "loc"]);

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

function serialize(value) {
    if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(",")}]`;
    // Tagged so Infinity/NaN do not collapse into JSON's "null".
    if (typeof value === "number") return `n:${String(value)}`;
    if (typeof value === "bigint") return `${value}n`;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    // Sorted keys keep the output independent of the AST serializer's field order.
    const keys = Object.keys(value)
        .filter((childKey) => !isDroppedKey(value, childKey))
        .sort();
    return `{${keys.map((childKey) => `${JSON.stringify(childKey)}:${serialize(value[childKey])}`).join(",")}}`;
}

/**
 * Serializes the AST of an emitted ES module so that bundler output details
 * with no runtime meaning (comments and annotations, whitespace, redundant
 * parentheses, literal spelling) do not affect the
 * result. Throws when `code` does not parse.
 */
export function canonicalProgram(fileName, code) {
    const { program, errors } = parseSync(fileName, code, {
        lang: "js",
        sourceType: "module",
        preserveParens: false,
    });
    if (errors.length > 0) throw new Error(`cannot parse bundled ${fileName}: ${errors[0].message}`);
    return serialize(program);
}

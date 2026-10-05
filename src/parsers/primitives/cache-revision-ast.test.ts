import { describe, expect, it } from "vitest";

import { canonicalProgram } from "../../../scripts/_cache-revision-ast.mjs";

function canonical(code: string): string {
    return canonicalProgram("revision.js", code);
}

describe("canonicalProgram", () => {
    it.each([
        ["comments", "const a = 1;", "/* x */ const a = 1; // y"],
        ["pure annotations", "const a = new Uint8Array(4);", "const a = /* @__PURE__ */ new Uint8Array(4);"],
        ["whitespace", "if (a) { b(); }", "if(a){\n\n  b();\n}"],
        ["redundant parentheses", "const a = b + c;", "const a = (b + c);"],
        ["number spelling", "const a = 16;", "const a = 0x10;"],
        ["string quotes", 'const a = "x";', "const a = 'x';"],
    ])("ignores %s", (_label, left, right) => {
        expect(canonical(left)).toBe(canonical(right));
    });

    it.each([
        ["an operator", "const a = b + c;", "const a = b - c;"],
        ["a number", "const a = 16;", "const a = 17;"],
        ["Infinity against null", "const a = 1e999;", "const a = null;"],
        ["a string", 'const a = "x";', 'const a = "y";'],
        ["regex flags", "const a = /x/g;", "const a = /x/gi;"],
        ["a bigint", "const a = 1n;", "const a = 2n;"],
        ["an identifier", "const a = b;", "const a = c;"],
        ["a suffixed free variable", "export default value$1;", "export default value$2;"],
        ["a suffixed property read", "export default record.value$1;", "export default record.value$2;"],
        ["a suffixed property key", "export default { value$1: 1 };", "export default { value$2: 1 };"],
        [
            "a suffixed destructuring key",
            "const { value$1: value } = record; export default value;",
            "const { value$2: value } = record; export default value;",
        ],
        [
            "a suffixed import name",
            'import { parse$1 as parse } from "external"; export default parse;',
            'import { parse$2 as parse } from "external"; export default parse;',
        ],
        [
            "a suffixed export name",
            "const value = 1; export { value as result$1 };",
            "const value = 1; export { value as result$2 };",
        ],
        [
            "an observable suffixed function name",
            "function parse$1() {} export default parse$1.name;",
            "function parse$2() {} export default parse$2.name;",
        ],
        [
            "which deconflicted binding a reference uses",
            "const log$1 = 1; const log$2 = 2; export { log$1 as a, log$2 as b };",
            "const log$1 = 1; const log$2 = 2; export { log$2 as a, log$1 as b };",
        ],
        ["statement order", "a(); b();", "b(); a();"],
    ])("distinguishes %s", (_label, left, right) => {
        expect(canonical(left)).not.toBe(canonical(right));
    });

    it("throws on code that does not parse", () => {
        expect(() => canonical("const = ;")).toThrow(/cannot parse bundled revision\.js/);
    });
});

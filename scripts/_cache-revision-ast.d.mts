// Hand-written declarations for _cache-revision-ast.mjs (plain JS on purpose -
// the cache revision generator runs on stock Node without type stripping) so
// src/parsers/primitives/cache-revision-ast.test.ts can import it under the
// strict tsconfig.

export declare function canonicalProgram(fileName: string, code: string): string;

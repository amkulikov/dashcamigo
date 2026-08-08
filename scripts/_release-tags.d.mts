// Hand-written declarations for _release-tags.mjs (plain JS on purpose - the
// changelog guard runs on stock Node without type stripping) so
// src/changelog/entries.test.ts can import ENTRY_ID_LINE_RE under the strict
// tsconfig.

export declare const ENTRIES_PATH: string;
export declare const ENTRY_ID_LINE_RE: RegExp;
export declare function git(...args: string[]): string;
export declare function compareReleaseTags(a: string, b: string): number;
export declare function previousReleaseTag(tag: string): string | undefined;
export declare function entryIdsAt(rev: string): string[] | null;

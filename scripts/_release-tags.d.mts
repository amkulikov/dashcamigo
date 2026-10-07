// Declarations for release helpers used by TypeScript tests.

export declare const ENTRIES_PATH: string;
export declare const ENTRY_ID_LINE_RE: RegExp;
export declare function git(...args: string[]): string;
export declare function compareReleaseTags(a: string, b: string): number;
export declare function previousReleaseTag(tag: string): string | undefined;
export declare function entryIdsAt(rev: string): string[] | null;

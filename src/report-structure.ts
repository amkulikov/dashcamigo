// Builds the plain-text "folder structure" report bundled into the feedback
// report (src/ui/feedback.ts) as camera-structure.txt - the key artifact for an
// unrecognised camera. Pure and byte-free: everything is derived
// from file paths, sizes and modified-times plus the filename techniques - which
// read names/paths only, never video content. The user sends this on purpose,
// by email, so it is a diagnostic body: English and technical terms are fine
// (voice.md allows jargon in the report body). It never contains GPS
// coordinates - no supported format encodes them in a filename.

import {
    classifyFilenameCameraKey,
    matchFilenameChannel,
    matchFilenameMode,
    matchFilenameSequence,
    matchFilenameTime,
} from "./parsers/filename/index.js";
import type { VendorFile } from "./parsers/types.js";
import { APP_VERSION } from "./version.js";

// Extensions that look like a dashcam recording. Used only to decide whether a
// zero-trips ingest is "an unrecognised camera" (worth offering the report) vs
// "the user dropped the wrong folder" (no video at all). Intentionally broad -
// a false positive just means the offer appears for a non-dashcam video folder,
// which is harmless.
const RECORDING_EXTENSIONS: ReadonlySet<string> = new Set([
    ".mp4",
    ".mov",
    ".ts",
    ".m2ts",
    ".mts",
    ".mkv",
    ".avi",
    ".wmv",
    ".3gp",
    ".insv",
    ".360",
    ".lrv",
    ".jdr",
    ".mdt",
]);

/** True if at least one file looks like a video recording. Gate for offering
 *  the "help add my camera" flow after a zero-trips ingest. */
export function looksLikeRecordings(files: readonly VendorFile[]): boolean {
    return files.some((f) => RECORDING_EXTENSIONS.has(extOf(f.file.name)));
}

/** Lowercased extension with leading dot, or "" when the name has none. */
function extOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** Basename without the trailing extension, lowercased - the pairing key that
 *  basename-sidecar formats (GPX / .map / .gps / .nmea / .3gf) rely on. */
function stemOf(name: string): string {
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    const base = slash < 0 ? name : name.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    return (dot < 0 ? base : base.slice(0, dot)).toLowerCase();
}

/** Human-readable byte size: "3.1 MB", "12 KB", "840 B". */
function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

/** UTC "YYYY-MM-DD HH:MM" from an epoch-ms timestamp. Deterministic (UTC, not
 *  locale) so two reports of the same card read identically. */
function fmtMtime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "-";
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

// Cap the per-file listing so a card with thousands of clips does not produce a
// multi-MB text file. The extension histogram and the technique summary already
// carry the shape; the raw list is for spotting naming patterns, and a few
// thousand lines is plenty. Truncation is announced in the file.
const MAX_LISTED_FILES = 3000;

/** Fields the filename techniques resolve, aggregated across the whole drop:
 *  the top matching technique id per field and how many files it covered. */
interface FieldSummary {
    field: string;
    topTechnique: string | null;
    matchedFiles: number;
    totalFiles: number;
}

function summarizeField(
    field: string,
    files: readonly VendorFile[],
    match: (f: VendorFile) => { matchedId: string | null },
): FieldSummary {
    const byTechnique = new Map<string, number>();
    for (const f of files) {
        const id = match(f).matchedId;
        if (id) byTechnique.set(id, (byTechnique.get(id) ?? 0) + 1);
    }
    let topTechnique: string | null = null;
    let matchedFiles = 0;
    for (const [id, n] of byTechnique) {
        if (n > matchedFiles) {
            matchedFiles = n;
            topTechnique = id;
        }
    }
    return { field, topTechnique, matchedFiles, totalFiles: files.length };
}

function renderFieldLine(s: FieldSummary): string {
    const label = s.field.padEnd(9);
    if (!s.topTechnique) return `  ${label} not recognised`;
    return `  ${label} ${s.topTechnique} (${s.matchedFiles}/${s.totalFiles} files)`;
}

/**
 * Builds the full report text from a snapshot of the ingested files.
 *
 * Sections: header (app version, counts), extension histogram, the filename
 * technique summary (which of time/channel/mode/sequence/camera-key have a
 * matching technique - the "is this just a filename gap?" triage), likely
 * basename sidecars, and the file listing (path, size, modified time).
 *
 * `files` is the raw ingest snapshot (state.lastIngestFiles) including hidden
 * proxy dirs - those (e.g. 70mai `.s_Front`) are useful onboarding signal.
 */
export function buildStructureReport(files: readonly VendorFile[]): string {
    const now = new Date();
    const totalBytes = files.reduce((s, f) => s + f.file.size, 0);
    const lines: string[] = [];

    lines.push("dashcamigo camera report");
    lines.push(`app ${APP_VERSION}  ·  generated ${now.toISOString()}`);
    lines.push(`files: ${files.length}  ·  total: ${humanSize(totalBytes)}`);
    lines.push("");
    lines.push("This lists only file names, sizes and dates from the card.");
    lines.push("No video, no GPS coordinates.");
    lines.push("");

    // Extension histogram, most common first.
    const byExt = new Map<string, number>();
    for (const f of files) {
        const e = extOf(f.file.name) || "(no ext)";
        byExt.set(e, (byExt.get(e) ?? 0) + 1);
    }
    lines.push("== extensions ==");
    for (const [e, n] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${e.padEnd(10)} ${n}`);
    }
    lines.push("");

    // Filename technique triage - the key signal for the developer: which
    // fields already have a matching technique and which are missing.
    lines.push("== filename techniques ==");
    lines.push(renderFieldLine(summarizeField("time", files, matchFilenameTime)));
    lines.push(renderFieldLine(summarizeField("channel", files, matchFilenameChannel)));
    lines.push(renderFieldLine(summarizeField("mode", files, matchFilenameMode)));
    lines.push(renderFieldLine(summarizeField("sequence", files, matchFilenameSequence)));
    const cameraKeys = new Set<string>();
    for (const f of files) {
        const k = classifyFilenameCameraKey(f);
        if (k) cameraKeys.add(k);
        if (cameraKeys.size >= 5) break;
    }
    lines.push(`  camera-key ${cameraKeys.size ? [...cameraKeys].join(", ") : "not recognised"}`);
    lines.push("");

    // Likely basename sidecars: a stem carried by both a video and a non-video
    // file usually means the GPS lives in that companion file.
    const stems = new Map<string, { videos: Set<string>; others: Set<string> }>();
    for (const f of files) {
        const stem = stemOf(f.file.name);
        const e = extOf(f.file.name);
        let entry = stems.get(stem);
        if (!entry) {
            entry = { videos: new Set(), others: new Set() };
            stems.set(stem, entry);
        }
        if (RECORDING_EXTENSIONS.has(e)) entry.videos.add(e);
        else if (e) entry.others.add(e);
    }
    const sidecarPairs: string[] = [];
    for (const [stem, entry] of stems) {
        if (entry.videos.size > 0 && entry.others.size > 0) {
            sidecarPairs.push(`  ${stem}: ${[...entry.videos].join("/")} + ${[...entry.others].join("/")}`);
        }
        if (sidecarPairs.length >= 30) break;
    }
    lines.push("== possible sidecars (same name, video + companion file) ==");
    lines.push(...(sidecarPairs.length ? sidecarPairs : ["  none found"]));
    lines.push("");

    // Full listing, path-sorted, capped.
    lines.push("== files ==");
    const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const shown = sorted.slice(0, MAX_LISTED_FILES);
    for (const f of shown) {
        const size = humanSize(f.file.size).padStart(9);
        const mtime = fmtMtime(f.file.lastModified);
        lines.push(`  ${f.relativePath}  ${size}  ${mtime}`);
    }
    if (sorted.length > shown.length) {
        lines.push(`  ... and ${sorted.length - shown.length} more (list truncated)`);
    }
    lines.push("");

    return lines.join("\n");
}

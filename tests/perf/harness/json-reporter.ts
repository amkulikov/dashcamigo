// Playwright custom reporter: collects per-test perf annotations and writes
// them in github-action-benchmark JSON schema to
// private/perf-results/<timestamp>.json + latest.json + latest.md.
//
// Schema: [{ name: string, value: number, unit: string, extra?: string }].
// One entry per metric per test. The 'extra' field is free-form - we put
// per-vendor breakdown JSON there for traceability.
//
// Tests publish their metrics via testInfo.annotations.push({type:'perf',
// description: JSON.stringify(payload)}). The reporter reads them in
// onTestEnd and accumulates.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const RESULTS_DIR = join(REPO_ROOT, "private", "perf-results");

interface BenchEntry {
    name: string;
    value: number;
    unit: string;
    extra?: string;
}

/**
 * Payload published by specs via testInfo.annotations. Reporter knows nothing
 * about specific scenarios; it just unpacks BenchEntry[] from each annotation.
 */
export interface PerfAnnotationPayload {
    entries: BenchEntry[];
    /** Optional dump of all scenario detail for the markdown table. Kept as
     *  arbitrary JSON; not part of the github-action-benchmark schema. */
    detail?: Record<string, unknown>;
}

class JsonReporter implements Reporter {
    private readonly all: BenchEntry[] = [];
    private readonly details: Array<{ test: string; detail: Record<string, unknown> }> = [];

    onTestEnd(test: TestCase, result: TestResult): void {
        for (const a of result.annotations) {
            if (a.type !== "perf" || !a.description) continue;
            let payload: PerfAnnotationPayload;
            try {
                payload = JSON.parse(a.description) as PerfAnnotationPayload;
            } catch {
                continue;
            }
            if (Array.isArray(payload.entries)) this.all.push(...payload.entries);
            if (payload.detail) this.details.push({ test: test.title, detail: payload.detail });
        }
    }

    onEnd(): void {
        if (this.all.length === 0) return;
        if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const tsPath = join(RESULTS_DIR, `${ts}.json`);
        const latestPath = join(RESULTS_DIR, "latest.json");
        const mdPath = join(RESULTS_DIR, "latest.md");

        const jsonOut = JSON.stringify(this.all, null, 2);
        writeFileSync(tsPath, jsonOut);
        writeFileSync(latestPath, jsonOut);
        writeFileSync(mdPath, this.renderMarkdown());
        // Stdout marker so an operator running test:perf sees the path
        // without digging through reporter output.
        process.stdout.write(`\nperf results: ${tsPath}\n`);
        process.stdout.write(`              ${latestPath}\n`);
        process.stdout.write(`              ${mdPath}\n`);
    }

    private renderMarkdown(): string {
        const lines: string[] = [];
        lines.push("# dashcamigo perf-suite results");
        lines.push("");
        lines.push(`Generated: ${new Date().toISOString()}`);
        lines.push("");
        lines.push("## Metrics (github-action-benchmark schema)");
        lines.push("");
        lines.push("| Name | Value | Unit |");
        lines.push("|------|------:|------|");
        for (const e of this.all) {
            lines.push(`| ${escapeMd(e.name)} | ${formatNum(e.value)} | ${escapeMd(e.unit)} |`);
        }
        if (this.details.length > 0) {
            lines.push("");
            lines.push("## Per-test detail");
            lines.push("");
            for (const d of this.details) {
                lines.push(`### ${escapeMd(d.test)}`);
                lines.push("");
                lines.push("```json");
                lines.push(JSON.stringify(d.detail, null, 2));
                lines.push("```");
                lines.push("");
            }
        }
        return lines.join("\n");
    }
}

function escapeMd(s: string): string {
    return s.replace(/\|/g, "\\|");
}

function formatNum(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    if (Math.abs(n) >= 1000) return Math.round(n).toString();
    return n.toFixed(3);
}

export default JsonReporter;

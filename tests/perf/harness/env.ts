// Shared env-knob parsing for perf scenarios.

/**
 * Reads a non-negative integer from the environment. Invalid values fall back
 * with a stderr warning instead of a silent NaN poisoning the timings.
 */
export function parseEnvInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        process.stderr.write(`warn: ${name}="${raw}" is not a non-negative integer, using ${fallback}\n`);
        return fallback;
    }
    return n;
}

export type EncoderPreference = "auto" | "hardware" | "software";

const STORAGE_KEY = "dashcamigo:encoder";
let cached: EncoderPreference | null = null;
const listeners = new Set<() => void>();

export function isEncoderPreference(value: unknown): value is EncoderPreference {
    return value === "auto" || value === "hardware" || value === "software";
}

export function getEncoderPreference(): EncoderPreference {
    if (cached !== null) return cached;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        cached = isEncoderPreference(stored) ? stored : "auto";
    } catch {
        cached = "auto";
    }
    return cached;
}

export function encoderAcceleration(preference: EncoderPreference): HardwareAcceleration {
    return preference === "software"
        ? "prefer-software"
        : preference === "hardware"
          ? "prefer-hardware"
          : "no-preference";
}

export function setEncoderPreference(preference: EncoderPreference): void {
    if (getEncoderPreference() === preference) return;
    cached = preference;
    try {
        localStorage.setItem(STORAGE_KEY, preference);
    } catch {
        // Keep the choice for this session when storage is unavailable.
    }
    for (const listener of listeners) listener();
}

export function subscribeEncoderPreference(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function _resetForTests(): void {
    cached = null;
    listeners.clear();
}

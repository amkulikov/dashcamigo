import { type CameraFlip, NO_CAMERA_FLIP, hasCameraFlip } from "../camera-flip.js";
import type { Channel } from "../parsers/types.js";
import type { Trip } from "../trips.js";
import { activeTrip } from "./state.js";

const STORAGE_KEY = "dashcamigo:player:flipByCamera";
const MAX_ENTRIES = 160;

interface Entry extends CameraFlip {
    key: string;
}

let entries: Entry[] | null = null;
let tripKeys = new WeakMap<Trip, Partial<Record<Channel, string>>>();

function loadEntries(): Entry[] {
    if (entries) return entries;
    entries = [];
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        if (Array.isArray(parsed)) {
            entries = parsed
                .filter(
                    (entry: unknown): entry is Entry =>
                        typeof entry === "object" &&
                        entry !== null &&
                        "key" in entry &&
                        typeof entry.key === "string" &&
                        "horizontal" in entry &&
                        typeof entry.horizontal === "boolean" &&
                        "vertical" in entry &&
                        typeof entry.vertical === "boolean",
                )
                .slice(0, MAX_ENTRIES);
        }
    } catch {
        // Unavailable or malformed storage must not block playback.
    }
    return entries;
}

function channelKey(trip: Trip, channel: Channel): string | undefined {
    let keys = tripKeys.get(trip);
    if (!keys?.[channel]) {
        keys ??= {};
        for (const frame of trip.frames) {
            for (const [ch, candidate] of Object.entries(frame.channels)) {
                if (candidate?.fingerprint && !keys[ch as Channel]) {
                    keys[ch as Channel] = JSON.stringify([candidate.fingerprint, ch]);
                }
            }
        }
        tripKeys.set(trip, keys);
    }
    return keys[channel];
}

export function cameraFlipForChannel(channel: Channel, trip = activeTrip()): Readonly<CameraFlip> {
    if (!trip) return NO_CAMERA_FLIP;
    const key = channelKey(trip, channel);
    const entry = loadEntries().find((entry) => entry.key === key);
    return entry ? { horizontal: entry.horizontal, vertical: entry.vertical } : NO_CAMERA_FLIP;
}

export function saveCameraFlip(channel: Channel, flip: CameraFlip, trip = activeTrip()): void {
    if (!trip) return;
    const key = channelKey(trip, channel);
    if (!key) return;
    const remaining = loadEntries().filter((entry) => entry.key !== key);
    entries = (hasCameraFlip(flip) ? [{ key, ...flip }, ...remaining] : remaining).slice(0, MAX_ENTRIES);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Keep the in-memory choice when browser storage is unavailable.
    }
}

export function _resetForTests(): void {
    entries = null;
    tripKeys = new WeakMap();
}

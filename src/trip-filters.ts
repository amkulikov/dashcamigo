import type { Trip } from "./trips.js";
import type { TripMetaAnnotation } from "./persist/types.js";
import { frameRecordingMode, tripAllCandidates } from "./trips.js";

export type TripFilterKind = "all" | "normal" | "parking";
export type TripToggleFilter = "event" | "manual" | "notes" | "favorites";

export interface TripFilters {
    kind: TripFilterKind;
    event: boolean;
    manual: boolean;
    notes: boolean;
    favorites: boolean;
}

export interface TripFilterFacts {
    kind: Exclude<TripFilterKind, "all"> | null;
    event: boolean;
    manual: boolean;
    notes: boolean;
    favorites: boolean;
}

export function tripFilterFacts(
    trip: Trip,
    meta?: Pick<TripMetaAnnotation, "note" | "isFavorite"> | null,
): TripFilterFacts {
    const candidates = tripAllCandidates(trip);
    return {
        // Only expose a trip type when the recordings establish it.
        kind: trip.isParking
            ? "parking"
            : trip.frames.some((f) => frameRecordingMode(f) === "normal")
              ? "normal"
              : null,
        event: candidates.some((c) => c.recordingMode === "event"),
        manual: candidates.some((c) => c.recordingMode === "manual"),
        notes: Boolean(meta?.note?.trim()),
        favorites: meta?.isFavorite === true,
    };
}

export function matchesTripFilters(facts: TripFilterFacts, filters: TripFilters): boolean {
    return (
        (filters.kind === "all" || facts.kind === filters.kind) &&
        (!filters.notes || facts.notes) &&
        (!filters.favorites || facts.favorites) &&
        ((!filters.event && !filters.manual) || (filters.event && facts.event) || (filters.manual && facts.manual))
    );
}

export function hasTripFilters(filters: TripFilters): boolean {
    return filters.kind !== "all" || filters.event || filters.manual || filters.notes || filters.favorites;
}

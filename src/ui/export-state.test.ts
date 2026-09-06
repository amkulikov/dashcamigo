import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTripTimeline, type Trip, type TripFrame } from "../trips.js";
import {
    _resetForTests,
    closeExportMode,
    exportPanelState,
    openExportMode,
    resetExportRangeForTrip,
    setExportModePreparation,
    setRange,
    subscribeExportState,
} from "./export-state.js";
import { state } from "./state.js";

function makeTrip(durationSec = 60): Trip {
    const frames: TripFrame[] = [{ startUtc: 1000, durationSec, wallDurationSec: durationSec, channels: {} }];
    return {
        frames,
        timeline: buildTripTimeline(frames),
        startUtc: 1000,
        endUtc: 1000 + durationSec,
        durationSec,
        totalBytes: 0,
        distanceKm: 0,
        records: [],
        events: [],
        inferredSegments: [],
        isParking: false,
        confidentChannels: new Set(),
        cameraTzSec: null,
    };
}

function pendingPreparation(): { promise: Promise<boolean>; resolve: (canOpen: boolean) => void } {
    let resolve!: (canOpen: boolean) => void;
    const promise = new Promise<boolean>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

beforeEach(() => {
    _resetForTests();
    state.trips = [makeTrip()];
    state.active = { trip: 0, frame: 0 };
    state.exportModeOpen = false;
    exportPanelState.range = null;
    exportPanelState.phase = "options";
    exportPanelState.configurationLocked = false;
});

afterEach(() => {
    _resetForTests();
    state.trips = [];
    state.active = null;
    state.exportModeOpen = false;
    exportPanelState.range = null;
});

describe("export mode preparation", () => {
    it("opens synchronously when no expanded presentation needs to close", () => {
        setExportModePreparation(() => null);
        let notifications = 0;
        subscribeExportState(() => {
            expect(state.exportModeOpen).toBe(true);
            notifications++;
        });

        openExportMode();

        expect(state.exportModeOpen).toBe(true);
        expect(notifications).toBe(1);
        expect(exportPanelState.range).toEqual({ startTripSec: 0, endTripSec: 60 });
    });

    it("waits for one preparation and preserves a range selected while leaving fullscreen", async () => {
        const pending = pendingPreparation();
        let preparations = 0;
        setExportModePreparation(() => {
            preparations++;
            return pending.promise;
        });
        const openStates: boolean[] = [];
        subscribeExportState(() => openStates.push(state.exportModeOpen));

        openExportMode();
        const range = exportPanelState.range;
        setRange(12, 29);
        openExportMode();

        expect(state.exportModeOpen).toBe(false);
        expect(preparations).toBe(1);
        expect(openStates).toEqual([false]);

        pending.resolve(true);
        await pending.promise;

        expect(state.exportModeOpen).toBe(true);
        expect(exportPanelState.range).toBe(range);
        expect(exportPanelState.range).toEqual({ startTripSec: 12, endTripSec: 29 });
        expect(openStates).toEqual([false, true]);
    });

    it("cancels an opening when the editor is closed before preparation finishes", async () => {
        const pending = pendingPreparation();
        setExportModePreparation(() => pending.promise);
        openExportMode();
        closeExportMode();

        pending.resolve(true);
        await pending.promise;

        expect(state.exportModeOpen).toBe(false);
    });

    it("keeps a replacement trip's range when its reset cancels a pending opening", async () => {
        const pending = pendingPreparation();
        setExportModePreparation(() => pending.promise);
        openExportMode();
        setRange(40, 55);

        const nextTrip = makeTrip(15);
        state.trips = [nextTrip];
        resetExportRangeForTrip(nextTrip);
        const nextRange = exportPanelState.range;
        pending.resolve(true);
        await pending.promise;

        expect(state.exportModeOpen).toBe(false);
        expect(exportPanelState.range).toBe(nextRange);
        expect(nextRange).toEqual({ startTripSec: 0, endTripSec: 15 });
    });

    it("does not activate after the active trip disappears during preparation", async () => {
        const pending = pendingPreparation();
        setExportModePreparation(() => pending.promise);
        openExportMode();
        state.active = null;

        pending.resolve(true);
        await pending.promise;

        expect(state.exportModeOpen).toBe(false);
    });

    it("allows a retry after preparation refuses to open the editor", async () => {
        const pending = pendingPreparation();
        setExportModePreparation(() => pending.promise);
        openExportMode();
        pending.resolve(false);
        await pending.promise;

        expect(state.exportModeOpen).toBe(false);
        setExportModePreparation(() => null);
        openExportMode();
        expect(state.exportModeOpen).toBe(true);
    });

    it("ignores a cancelled preparation when a newer opening is still waiting", async () => {
        const cancelled = pendingPreparation();
        setExportModePreparation(() => cancelled.promise);
        openExportMode();
        closeExportMode();

        const current = pendingPreparation();
        setExportModePreparation(() => current.promise);
        openExportMode();
        cancelled.resolve(true);
        await cancelled.promise;
        expect(state.exportModeOpen).toBe(false);

        current.resolve(true);
        await current.promise;
        expect(state.exportModeOpen).toBe(true);
    });
});

// Unit tests for the connectivity tracker. Pure logic (node env): navigator and
// window's addEventListener are stubbed, and the module is re-imported per test
// (vi.resetModules) so its singleton state does not leak between cases. Order
// mirrors production: initConnectivity() runs first, subscribers attach after.

import { afterEach, describe, expect, it, vi } from "vitest";

type Conn = typeof import("./connectivity.js");

let mod: Conn;
let onlineHandlers: Array<() => void>;
let offlineHandlers: Array<() => void>;

async function load(onLine: boolean): Promise<void> {
    vi.resetModules();
    onlineHandlers = [];
    offlineHandlers = [];
    vi.stubGlobal("navigator", { onLine });
    vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
        if (type === "online") onlineHandlers.push(handler);
        if (type === "offline") offlineHandlers.push(handler);
    });
    mod = await import("./connectivity.js");
}

const fireOnline = (): void => {
    for (const h of onlineHandlers) h();
};
const fireOffline = (): void => {
    for (const h of offlineHandlers) h();
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("connectivity", () => {
    it("starts online; a subscriber gets one initial false, no duplicate", async () => {
        await load(true);
        mod.initConnectivity();
        const seen: boolean[] = [];
        mod.subscribeConnectivity((o) => seen.push(o));
        expect(mod.isOffline()).toBe(false);
        expect(seen).toEqual([false]);
    });

    it("launching offline (navigator.onLine=false) is reported immediately", async () => {
        await load(false);
        mod.initConnectivity();
        const seen: boolean[] = [];
        mod.subscribeConnectivity((o) => seen.push(o));
        expect(mod.isOffline()).toBe(true);
        expect(seen).toEqual([true]);
    });

    it("navigator offline/online events flip the state", async () => {
        await load(true);
        mod.initConnectivity();
        const seen: boolean[] = [];
        mod.subscribeConnectivity((o) => seen.push(o));
        fireOffline();
        expect(mod.isOffline()).toBe(true);
        fireOnline();
        expect(mod.isOffline()).toBe(false);
        expect(seen).toEqual([false, true, false]);
    });

    it("map tile network failure trips offline even while navigator stays online (limbo)", async () => {
        await load(true); // navigator.onLine stays true the whole time
        mod.initConnectivity();
        const seen: boolean[] = [];
        mod.subscribeConnectivity((o) => seen.push(o));
        mod.reportMapTileNetworkError();
        expect(mod.isOffline()).toBe(true);
        // Idempotent: a second tile failure does not re-notify.
        mod.reportMapTileNetworkError();
        mod.reportMapTilesOk();
        expect(mod.isOffline()).toBe(false);
        expect(seen).toEqual([false, true, false]);
    });

    it("OR-composition: clearing one source while the other still holds stays offline", async () => {
        await load(true);
        mod.initConnectivity();
        const seen: boolean[] = [];
        mod.subscribeConnectivity((o) => seen.push(o));
        fireOffline(); // nav offline
        mod.reportMapTileNetworkError(); // tiles also down -> no transition (already offline)
        fireOnline(); // nav back, but tiles still down -> STILL offline, no transition
        expect(mod.isOffline()).toBe(true);
        mod.reportMapTilesOk(); // last source clears -> online
        expect(mod.isOffline()).toBe(false);
        // Only two transitions ever broadcast: false->true (offline event) and
        // true->false (tiles ok). The interim same-value calls are suppressed.
        expect(seen).toEqual([false, true, false]);
    });

    it("initConnectivity is idempotent", async () => {
        await load(true);
        mod.initConnectivity();
        mod.initConnectivity();
        // Only one set of handlers registered despite two init calls.
        expect(onlineHandlers).toHaveLength(1);
        expect(offlineHandlers).toHaveLength(1);
    });
});

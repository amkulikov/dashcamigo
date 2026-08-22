import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureFileReadwritePermission } from "./folders.js";

function handleWithPermission(
    current: PermissionState,
    requested: PermissionState = "granted",
): { handle: FileSystemFileHandle; request: ReturnType<typeof vi.fn> } {
    const request = vi.fn(async () => requested);
    const handle = {
        queryPermission: vi.fn(async () => current),
        requestPermission: request,
    } as unknown as FileSystemFileHandle;
    return { handle, request };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("ensureFileReadwritePermission", () => {
    it("reports an already-granted handle as writable without prompting", async () => {
        const { handle, request } = handleWithPermission("granted");
        await expect(ensureFileReadwritePermission(handle)).resolves.toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it("does not prompt after user activation has expired", async () => {
        vi.stubGlobal("navigator", { userActivation: { isActive: false } });
        const { handle, request } = handleWithPermission("prompt");
        await expect(ensureFileReadwritePermission(handle)).resolves.toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it("returns the result of a prompt made during active user input", async () => {
        vi.stubGlobal("navigator", { userActivation: { isActive: true } });
        const granted = handleWithPermission("prompt", "granted");
        const denied = handleWithPermission("prompt", "denied");
        await expect(ensureFileReadwritePermission(granted.handle)).resolves.toBe(true);
        await expect(ensureFileReadwritePermission(denied.handle)).resolves.toBe(false);
    });

    it("lets adapter handles without permission methods try the write", async () => {
        await expect(ensureFileReadwritePermission({} as FileSystemFileHandle)).resolves.toBe(true);
    });
});

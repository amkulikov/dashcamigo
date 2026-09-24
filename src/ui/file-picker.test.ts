import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests, withFilePicker } from "./file-picker.js";
import { notify } from "./notifications.js";

vi.mock("./notifications.js", () => ({ notify: vi.fn() }));

beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
});

describe("native file picker ownership", () => {
    it("calls the picker synchronously to preserve the user gesture", async () => {
        let isCalled = false;
        const result = withFilePicker("save", () => {
            isCalled = true;
            return Promise.resolve("picked");
        });
        expect(isCalled).toBe(true);
        await expect(result).resolves.toBe("picked");
    });

    it("blocks other picker kinds until the owner settles", async () => {
        let finish!: (value: string) => void;
        const pending = new Promise<string>((resolve) => {
            finish = resolve;
        });
        const owner = withFilePicker("directory", () => pending);
        let competingCalls = 0;
        const competingPicker = async () => {
            competingCalls++;
            return "file";
        };

        await expect(withFilePicker("save", competingPicker)).resolves.toBeNull();
        await expect(withFilePicker("open", competingPicker)).resolves.toBeNull();
        expect(competingCalls).toBe(0);
        expect(notify).toHaveBeenCalledWith({ severity: "warn", messageKey: "filePicker.busy" });

        finish("folder");
        await expect(owner).resolves.toBe("folder");
        await expect(withFilePicker("save", competingPicker)).resolves.toBe("file");
        expect(competingCalls).toBe(1);
    });

    it("releases ownership after cancellation without consuming the abort", async () => {
        const abort = new DOMException("cancelled", "AbortError");
        await expect(withFilePicker("directory", () => Promise.reject(abort))).rejects.toBe(abort);
        expect(notify).not.toHaveBeenCalled();
        await expect(withFilePicker("save", async () => "file")).resolves.toBe("file");
    });

    it("releases ownership after a synchronous picker failure", async () => {
        const failure = new TypeError("invalid picker options");
        await expect(
            withFilePicker("save", () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
        await expect(withFilePicker("directory", async () => "folder")).resolves.toBe("folder");
    });

    it("explains an active browser picker without retrying it", async () => {
        let calls = 0;
        const result = await withFilePicker("save", async () => {
            calls++;
            throw new DOMException(
                "Failed to execute 'showSaveFilePicker' on 'Window': File picker already active.",
                "NotAllowedError",
            );
        });
        expect(result).toBeNull();
        expect(calls).toBe(1);
        expect(notify).toHaveBeenCalledOnce();
        await expect(withFilePicker("save", async () => "file")).resolves.toBe("file");
    });

    it("preserves unrelated permission failures", async () => {
        const failure = new DOMException("permission denied", "NotAllowedError");
        await expect(withFilePicker("open", () => Promise.reject(failure))).rejects.toBe(failure);
        expect(notify).not.toHaveBeenCalled();
    });

    it("lets a caller show the conflict in its own panel without a duplicate toast", async () => {
        const onBusy = vi.fn();
        const result = await withFilePicker(
            "save",
            async () => {
                throw new DOMException("File picker already active.", "NotAllowedError");
            },
            onBusy,
        );
        expect(result).toBeNull();
        expect(onBusy).toHaveBeenCalledOnce();
        expect(notify).not.toHaveBeenCalled();
    });
});

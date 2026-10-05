import { afterEach, describe, expect, it, vi } from "vitest";
import { collectGraphicsDiagnostics } from "./graphics-diagnostics.js";

afterEach(() => vi.unstubAllGlobals());

describe("collectGraphicsDiagnostics", () => {
    it("keeps the report available without WebGL", () => {
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
        expect(collectGraphicsDiagnostics()).toMatchObject({
            context: "unavailable",
            unmaskedRenderer: null,
            error: null,
        });
    });

    it.each([true, false])("releases its context when renderer details are exposed: %s", (exposed) => {
        let released = false;
        const context = {
            VENDOR: 1,
            RENDERER: 2,
            getParameter: (id: number) => [null, "browser vendor", "browser renderer", "GPU vendor", "GPU model"][id],
            getExtension: (extension: string) => {
                if (extension === "WEBGL_debug_renderer_info") {
                    return exposed ? { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 } : null;
                }
                if (extension === "WEBGL_lose_context")
                    return {
                        loseContext: () => {
                            released = true;
                        },
                    };
                return null;
            },
        };
        vi.stubGlobal("document", {
            createElement: () => ({ getContext: (type: string) => (type === "webgl" ? context : null) }),
        });
        expect(collectGraphicsDiagnostics()).toEqual({
            context: "webgl",
            vendor: "browser vendor",
            renderer: "browser renderer",
            unmaskedVendor: exposed ? "GPU vendor" : null,
            unmaskedRenderer: exposed ? "GPU model" : null,
            error: null,
        });
        expect(released).toBe(true);
    });

    it("releases the context and records a failed query without throwing", () => {
        let released = false;
        vi.stubGlobal("document", {
            createElement: () => ({
                getContext: () => ({
                    getParameter: () => {
                        throw new Error("graphics query failed");
                    },
                    getExtension: () => ({
                        loseContext: () => {
                            released = true;
                        },
                    }),
                }),
            }),
        });
        expect(collectGraphicsDiagnostics().error).toBe("graphics query failed");
        expect(released).toBe(true);
    });
});

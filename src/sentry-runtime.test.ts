// Exercise the real SDK with an intercepted fetch boundary. No event leaves
// the process, including automatic client reports and session envelopes.
import { getClient, getIsolationScope } from "@sentry/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./log.js";
import {
    CRASH_REPORTING_STORAGE_KEY,
    _resetForTests,
    captureSentryException,
    captureSentryMessage,
    crashReportingEnabled,
    initSentry,
    setCrashReportingEnabled,
    setSentryContext,
    setSentryTags,
} from "./sentry.js";

interface RequestRecord {
    body: string;
    signal: AbortSignal | null | undefined;
}

let requests: RequestRecord[] = [];
let shouldHoldRequests = false;
let storedChoices: Map<string, string>;
let browserWindow: EventTarget;

function sendStorageEvent(key: string | null = CRASH_REPORTING_STORAGE_KEY): void {
    browserWindow.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea: localStorage }));
}

async function interceptedFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
    requests.push({ body: String(init?.body), signal: init?.signal });
    if (shouldHoldRequests) {
        await new Promise<void>((_resolve, reject) => {
            if (init?.signal?.aborted) reject(init.signal.reason);
            else init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
    }
    return new Response("{}", { status: 200 });
}

beforeEach(() => {
    _resetForTests();
    getIsolationScope().clear();
    requests = [];
    shouldHoldRequests = false;
    vi.stubGlobal("fetch", interceptedFetch);
    browserWindow = Object.assign(new EventTarget(), { location: { hostname: "everydashcam.app" } });
    vi.stubGlobal("window", browserWindow);
    storedChoices = new Map();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => storedChoices.get(key) ?? null,
        setItem: (key: string, value: string) => storedChoices.set(key, value),
    });
    vi.stubEnv("VITE_SENTRY_DSN", "https://deadbeef@o4511528520843264.ingest.de.sentry.io/9998887");
});

afterEach(async () => {
    setCrashReportingEnabled(false);
    await vi.dynamicImportSettled();
    await getClient()?.flush(1000);
    _resetForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("crash reporting consent lifecycle", () => {
    it.each(["off", "clear"])("stops the active transport after another tab chooses %s", async (choice) => {
        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        const client = getClient();
        shouldHoldRequests = true;
        captureSentryMessage("in flight before cross-tab opt-out");
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        const signal = requests[0]?.signal;
        expect(signal?.aborted).toBe(false);

        if (choice === "clear") storedChoices.clear();
        else storedChoices.set(CRASH_REPORTING_STORAGE_KEY, "off");
        expect(crashReportingEnabled()).toBe(false);
        sendStorageEvent(choice === "clear" ? null : CRASH_REPORTING_STORAGE_KEY);
        expect(signal?.aborted).toBe(true);
        expect(client?.getOptions().enabled).toBe(false);
        client?.captureException(new Error("uncaught after cross-tab opt-out"));
        captureSentryMessage("message after cross-tab opt-out");
        await client?.flush(1000);
        expect(requests).toHaveLength(1);

        shouldHoldRequests = false;
        storedChoices.set(CRASH_REPORTING_STORAGE_KEY, "on");
        sendStorageEvent();
        await vi.dynamicImportSettled();
        captureSentryMessage("message after cross-tab opt-in");
        expect(await getClient()?.flush(1000)).toBe(true);
        expect(requests).toHaveLength(2);
        expect(requests[1]?.body).toContain("message after cross-tab opt-in");
    });

    it("discards pending captures when another tab withdraws consent during SDK load", async () => {
        setCrashReportingEnabled(true);
        captureSentryMessage("pending before cross-tab opt-out");
        storedChoices.set(CRASH_REPORTING_STORAGE_KEY, "off");
        sendStorageEvent();
        await vi.dynamicImportSettled();
        expect(requests).toHaveLength(0);

        storedChoices.set(CRASH_REPORTING_STORAGE_KEY, "on");
        sendStorageEvent();
        await vi.dynamicImportSettled();
        captureSentryMessage("fresh message after cross-tab opt-in");
        expect(await getClient()?.flush(1000)).toBe(true);
        const payload = requests.map((request) => request.body).join("\n");
        expect(payload).toContain("fresh message after cross-tab opt-in");
        expect(payload).not.toContain("pending before cross-tab opt-out");
    });

    it.each(["everydashcam.app", "self-host.test", "deploy-preview.pages.dev", "localhost"])(
        "discards startup errors and old preferences until explicit consent on %s",
        async (hostname) => {
            Object.assign(browserWindow, { location: { hostname } });
            storedChoices.set("dashcamigo:crash-reporting", "off");
            initSentry();
            captureSentryMessage("before consent message");
            captureSentryException(new Error("before consent exception"));
            setSentryTags({ startup: "before-consent-tag" });
            setSentryContext("startup", { status: "before-consent-context" });
            await vi.dynamicImportSettled();
            expect(requests).toHaveLength(0);

            setCrashReportingEnabled(true);
            captureSentryMessage("after consent message");
            setSentryTags({ optedIn: "after-consent-tag" });
            setSentryContext("enabled", { status: "after-consent-context" });
            await vi.dynamicImportSettled();
            expect(await getClient()?.flush(1000)).toBe(true);

            const payload = requests.map((request) => request.body).join("\n");
            expect(payload).toContain("after consent message");
            expect(payload).toContain("after-consent-tag");
            expect(payload).toContain("after-consent-context");
            expect(payload).not.toContain("before consent");
            expect(payload).not.toContain("before-consent");
        },
    );

    it("cancels initialization and drops its pending queue when consent is withdrawn", async () => {
        setCrashReportingEnabled(true);
        captureSentryMessage("cancelled pending message");
        setSentryContext("cancelled", { status: "cancelled-pending-context" });
        setCrashReportingEnabled(false);
        await vi.dynamicImportSettled();
        expect(requests).toHaveLength(0);

        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        captureSentryMessage("fresh consent message");
        expect(await getClient()?.flush(1000)).toBe(true);
        const payload = requests.map((request) => request.body).join("\n");
        expect(payload).toContain("fresh consent message");
        expect(payload).not.toContain("cancelled pending message");
        expect(payload).not.toContain("cancelled-pending-context");
    });

    it("aborts pending transport and prevents close from flushing more reports", async () => {
        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        const client = getClient();
        expect(client).toBeDefined();

        shouldHoldRequests = true;
        captureSentryMessage("in flight report");
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        const signal = requests[0]?.signal;
        expect(signal?.aborted).toBe(false);

        let releaseQueuedEvent = () => {};
        const queued = new Promise<void>((resolve) => {
            releaseQueuedEvent = resolve;
        });
        client?.addEventProcessor(async (event) => {
            if (event.message === "queued before shutdown") await queued;
            return event;
        });
        captureSentryMessage("queued before shutdown");
        setCrashReportingEnabled(false);
        expect(signal?.aborted).toBe(true);
        releaseQueuedEvent();
        captureSentryMessage("after shutdown report");
        // Uncaught errors use the SDK directly, so exercise that path too.
        client?.captureException(new Error("uncaught after shutdown"));
        await client?.flush(1000);
        expect(requests).toHaveLength(1);

        shouldHoldRequests = false;
        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        captureSentryMessage("enabled again report");
        expect(await getClient()?.flush(1000)).toBe(true);
        expect(requests).toHaveLength(2);
        expect(requests[1]?.body).toContain("enabled again report");
        expect(requests[1]?.signal?.aborted).toBe(false);
    });

    it("keeps a new client enabled when an older close finishes late", async () => {
        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        const oldClient = getClient();
        let releaseOldEvent = () => {};
        const oldEvent = new Promise<void>((resolve) => {
            releaseOldEvent = resolve;
        });
        oldClient?.addEventProcessor(async (event) => {
            await oldEvent;
            return event;
        });
        captureSentryMessage("old pending report");
        setCrashReportingEnabled(false);
        setSentryTags({ inactive: "disabled-tag" });
        setSentryContext("inactive", { status: "disabled-context" });
        createLogger("sentry-test").info("disabled breadcrumb");
        oldClient?.captureException(new Error("disabled exception"));

        setCrashReportingEnabled(true);
        await vi.dynamicImportSettled();
        releaseOldEvent();
        await oldClient?.flush(1000);
        captureSentryMessage("new client report");
        expect(await getClient()?.flush(1000)).toBe(true);

        const payload = requests.map((request) => request.body).join("\n");
        expect(payload).toContain("new client report");
        expect(payload).not.toContain("old pending report");
        expect(payload).not.toContain("disabled");
    });
});

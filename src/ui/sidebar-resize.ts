// Drag handle between sidebar and main area. Width stored in --sidebar-width on :root and persisted to localStorage.
// mousemove is on document because the cursor can escape the handle during fast drags.

import { dom } from "./dom.js";

const SIDEBAR_WIDTH_KEY = "dashcamigo:sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 600;

// Defense-in-depth: sidebar-resize is hidden via display:none on mobile,
// but DevTools touch emulation can still fire pointer events.
// In drawer mode --sidebar-width is not used by CSS so resizing would be meaningless.
const isMobileLayout = (): boolean => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

function lsGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        // Private mode or storage disabled - silent fall through to defaults.
        return null;
    }
}

function lsSet(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Quota exceeded or storage disabled - persistence is best-effort.
    }
}

function restoreSidebarWidth(): void {
    const saved = parseInt(lsGet(SIDEBAR_WIDTH_KEY) || "", 10);
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
        document.documentElement.style.setProperty("--sidebar-width", `${saved}px`);
    }
}

export function initSidebarResize(): void {
    restoreSidebarWidth();

    let sidebarDragging = false;

    dom.sidebarResize.addEventListener("mousedown", (e) => {
        if (isMobileLayout()) return;
        e.preventDefault();
        sidebarDragging = true;
        dom.sidebarResize.classList.add("dragging");
        document.body.classList.add("sidebar-resizing");
    });

    document.addEventListener("mousemove", (e) => {
        if (!sidebarDragging) return;
        const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX));
        document.documentElement.style.setProperty("--sidebar-width", `${w}px`);
    });

    document.addEventListener("mouseup", () => {
        if (!sidebarDragging) return;
        sidebarDragging = false;
        dom.sidebarResize.classList.remove("dragging");
        document.body.classList.remove("sidebar-resizing");
        const cur = document.documentElement.style.getPropertyValue("--sidebar-width");
        const w = parseInt(cur, 10);
        if (Number.isFinite(w)) lsSet(SIDEBAR_WIDTH_KEY, String(w));
    });

    // Arrow keys when the handle is focused shift by 16 px for accessibility.
    dom.sidebarResize.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (isMobileLayout()) return;
        e.preventDefault();
        const cur = parseInt(document.documentElement.style.getPropertyValue("--sidebar-width"), 10) || 280;
        const step = e.key === "ArrowLeft" ? -16 : 16;
        const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, cur + step));
        document.documentElement.style.setProperty("--sidebar-width", `${w}px`);
        lsSet(SIDEBAR_WIDTH_KEY, String(w));
    });
}

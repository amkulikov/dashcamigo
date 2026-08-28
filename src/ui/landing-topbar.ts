// The landing starts as one uninterrupted surface. Once its own scroll
// container moves, the topbar becomes an elevated app-chrome surface so the
// controls stay visually anchored above the content passing underneath.

const SCROLLED_THRESHOLD_PX = 16;

let landingRoot: HTMLElement | null = null;
let onScroll: (() => void) | null = null;

/** Keeps the landing-only topbar treatment in sync with the landing scroll container. */
export function initLandingTopbar(): void {
    if (landingRoot) return;

    landingRoot = document.getElementById("landing");
    if (!landingRoot) return;
    const root = landingRoot;

    let isScrolled: boolean | null = null;
    onScroll = () => {
        const nextIsScrolled = root.scrollTop >= SCROLLED_THRESHOLD_PX;
        if (nextIsScrolled === isScrolled) return;
        isScrolled = nextIsScrolled;
        document.body.classList.toggle("landing-scrolled", nextIsScrolled);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
}

/** Releases the scroll listener before the landing subtree is removed. */
export function disconnectLandingTopbar(): void {
    if (landingRoot && onScroll) landingRoot.removeEventListener("scroll", onScroll);
    landingRoot = null;
    onScroll = null;
    document.body.classList.remove("landing-scrolled");
}

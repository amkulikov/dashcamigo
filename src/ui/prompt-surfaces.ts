/** Watches prompt blockers without observing the player's per-frame DOM updates. */
export function observePromptSurfaces(onChange: () => void): MutationObserver {
    const observer = new MutationObserver(onChange);
    observer.observe(document.body, { childList: true });
    for (const surface of document.querySelectorAll<HTMLElement>('.sticky-banner, [role="dialog"], #export-panel')) {
        observer.observe(surface, { attributes: true, attributeFilter: ["hidden"] });
    }
    const langBannerParent = document.getElementById("lang-banner")?.parentElement;
    if (langBannerParent && langBannerParent !== document.body) observer.observe(langBannerParent, { childList: true });
    return observer;
}

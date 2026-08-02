// Shared modal a11y manager. Modals keep their own show/hide DOM mechanics
// (some toggle [hidden], some toggle an .is-open class, some custom-render);
// this module owns the cross-cutting concerns that were previously duplicated
// (or missing) per dialog:
//   - body scroll-lock while any modal is open (released when the last closes);
//   - focus-trap: Tab/Shift+Tab cycle within the topmost modal;
//   - focus restore: the element focused before opening is refocused on close;
//   - a single Escape handler driven by a stack, so Escape closes only the
//     topmost modal (no more N independent document listeners each firing).
//
// Usage: call activateModal(el, { onClose, initialFocus }) right after the
// modal becomes visible, and deactivateModal(el) right after it is hidden.
// onClose is the modal's own close function - the manager calls it for Escape.

interface ModalEntry {
    el: HTMLElement;
    onClose: () => void;
    savedFocus: HTMLElement | null;
    /** Where the modal lived before it was re-homed under the fullscreen
     *  element, so it can go back on close. Null when it was not moved. */
    home: { parent: Node; next: Node | null } | null;
}

// Topmost = last. A stack (not a single ref) so nested dialogs - e.g. the reset
// confirm opened from settings - close in LIFO order and the scroll-lock is
// only released when the last one goes away.
const stack: ModalEntry[] = [];
let keydownBound = false;

const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableWithin(el: HTMLElement): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        // Skip elements hidden via display:none / visibility (offsetParent is
        // null for them); good enough without a full visibility computation.
        (n) => n.offsetParent !== null || n === document.activeElement,
    );
}

/** True while at least one modal is tracked (open). Feature-level global
 *  keydown listeners (player hotkeys, view-menu) consult this to stay inert
 *  under an open modal: the capture-phase trap only swallows Escape/Tab, so
 *  without this guard letter shortcuts (F/U/S/E, C/T/M) would fire on the
 *  player/panels behind the backdrop. */
export function isAnyModalOpen(): boolean {
    return stack.length > 0;
}

function onKeydown(ev: KeyboardEvent): void {
    const top = stack[stack.length - 1];
    if (!top) return;

    if (ev.key === "Escape") {
        // stopPropagation so a single Escape does not also reach feature-level
        // listeners (player hotkeys, etc.) underneath the modal.
        ev.preventDefault();
        ev.stopPropagation();
        top.onClose();
        return;
    }

    if (ev.key !== "Tab") return;
    const focusable = focusableWithin(top.el);
    if (focusable.length === 0) {
        // Nothing focusable inside - keep focus pinned on the modal root so Tab
        // cannot escape to the page behind the backdrop.
        ev.preventDefault();
        top.el.focus();
        return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey) {
        if (active === first || !top.el.contains(active)) {
            ev.preventDefault();
            last.focus();
        }
    } else if (active === last || !top.el.contains(active)) {
        ev.preventDefault();
        first.focus();
    }
}

/**
 * Activates a11y management for a now-visible modal. Saves the current focus,
 * locks body scroll (first modal only), and moves focus inside - to
 * initialFocus if given, else the first focusable element, else the modal root
 * (which must be focusable, e.g. tabindex="-1", for the trap to hold).
 */
export function activateModal(el: HTMLElement, opts: { onClose: () => void; initialFocus?: HTMLElement | null }): void {
    // Re-activating an already-tracked modal is a no-op (idempotent open).
    if (stack.some((e) => e.el === el)) return;

    if (!keydownBound) {
        // Capture phase so the trap/Escape run before feature-level handlers.
        document.addEventListener("keydown", onKeydown, true);
        keydownBound = true;
    }

    const savedFocus = (document.activeElement as HTMLElement) ?? null;
    if (stack.length === 0) document.body.style.overflow = "hidden";
    stack.push({ el, onClose: opts.onClose, savedFocus, home: adoptIntoFullscreen(el) });

    // preventScroll: several modals put initialFocus on a "Close" button in
    // the card's footer (settings, CSP, unsupported-formats). A plain focus()
    // scrolls the focused element into view, so a card taller than the
    // viewport opened scrolled to the bottom. Focus still lands on the
    // button for Escape/Enter; it just doesn't drag the scroll with it.
    const target = opts.initialFocus ?? focusableWithin(el)[0] ?? el;
    target.focus?.({ preventScroll: true });
}

/**
 * Moves a modal under the fullscreen element for as long as it is open, and
 * reports where it came from. While fullscreen is on, only that element's
 * subtree is painted - and every modal sits outside .player-wrap, so opening
 * one from the fullscreen player bar showed nothing while the focus trap held
 * the keyboard in a dialog the user could not see. The modals are
 * position:fixed, so the move does not change their on-screen geometry.
 * Returns null when there is nothing to do (no fullscreen, already inside, or
 * a media element is fullscreen - that one takes no children).
 */
function adoptIntoFullscreen(el: HTMLElement): ModalEntry["home"] {
    const fullscreen = document.fullscreenElement;
    if (!(fullscreen instanceof HTMLElement) || fullscreen instanceof HTMLMediaElement) return null;
    if (fullscreen.contains(el) || !el.parentNode) return null;
    const home = { parent: el.parentNode, next: el.nextSibling };
    fullscreen.appendChild(el);
    return home;
}

/**
 * Wires backdrop-click-to-dismiss on the modal root `el`: a click that lands on
 * the backdrop (not inside the card) calls `onClose`. Centralizes the listener
 * every modal used to hand-wire in one of two flavors:
 *   - no cardSelector: close only when the click target IS the root (backdrop is
 *     the root itself, the card is a direct child that catches its own clicks);
 *   - cardSelector given: close when the click is outside the matched card -
 *     needed when wrapper elements sit between the root and the card, so a plain
 *     target===root check would miss backdrop clicks.
 * The listener lives for the element's lifetime (modals are long-lived
 * singletons wired once at init). Escape/focus-trap/scroll-lock stay in
 * activateModal; this is only the pointer-dismiss half.
 */
export function wireBackdropDismiss(el: HTMLElement, onClose: () => void, opts: { cardSelector?: string } = {}): void {
    const { cardSelector } = opts;
    el.addEventListener("click", (ev) => {
        if (cardSelector) {
            if (ev.target instanceof Element && !ev.target.closest(cardSelector)) onClose();
        } else if (ev.target === el) {
            onClose();
        }
    });
}

/**
 * Releases a11y management for a now-hidden modal. Restores body scroll when no
 * modals remain and refocuses the element that was focused before this modal
 * opened. No-op if the modal was not tracked.
 */
export function deactivateModal(el: HTMLElement): void {
    const idx = stack.findIndex((e) => e.el === el);
    if (idx === -1) return;
    const [entry] = stack.splice(idx, 1);
    if (stack.length === 0) document.body.style.overflow = "";
    // Back to its own place in the document before anything else looks for it
    // there (a later open outside fullscreen, a querySelector on the layout).
    if (entry?.home) {
        const { parent, next } = entry.home;
        // The recorded sibling can be gone by now (a re-render of whatever sits
        // around the modal). Landing at the end of the same parent is still the
        // right document, and these are position:fixed overlays - order in the
        // parent carries no layout meaning.
        if (next && next.parentNode === parent) parent.insertBefore(entry.el, next);
        else parent.appendChild(entry.el);
    }
    entry?.savedFocus?.focus?.();
}

// Marks an intentional in-app navigation so the beforeunload guard in app.ts
// does not add a redundant second "Leave site?" prompt.
//
// The guard warns when the user is about to lose loaded recordings on an
// accidental close/reload. A deliberate language switch already confirms that
// loss through its own modal (see switch-lang-modal / lang-switcher), so the
// browser's generic prompt on top would be a confusing double confirmation.
// The switcher sets this flag right before location.assign; app.ts reads it.
//
// One-way latch: it is only ever set true, and immediately precedes a full
// navigation that tears down the page, so there is nothing to reset.

let intentional = false;

/** Call right before a deliberate full-page navigation. */
export function markIntentionalNavigation(): void {
    intentional = true;
}

/** True once markIntentionalNavigation() has run - the beforeunload guard skips. */
export function isIntentionalNavigation(): boolean {
    return intentional;
}

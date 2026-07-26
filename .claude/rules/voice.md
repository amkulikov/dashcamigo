---
paths:
  - "src/i18n/**/*"
  - "vite-plugins/**/*"
  - "index.html"
  - "public/*.html"
---

# Tone of voice (user-visible copy)

Canonical source of truth for the tone of every user-visible string: the product
UI, error messages, the landing page, and the marketing/SEO pages. This rule loads
automatically when you touch the files that hold copy (i18n dictionaries, landing
and marketing pages, static HTML).

**English is the source of truth for meaning.** Every other locale is verified
against the English string, never the reverse. On the tone and wording of
user-visible copy, this file is the final word; engineering concerns (raw error
strings in code, the i18n machinery — the `I18nKey` union, `satisfies`, the parity
test, prerender) stay under CLAUDE.md → Localization. When the two overlap, this file
wins on *how it reads*, CLAUDE.md wins on *how it is wired*.

---

## Audience

Non-technical drivers, not developers. Someone who plugged an SD card into their
laptop to look at yesterday's drive. They do not know — and should not need to know —
what a codec or a container is.

Keep user-facing copy plain. Say the **outcome**, never the implementation.

The test: if a word describes *how it works under the hood* rather than *what the
user gets*, drop it. The list below is illustrative, not exhaustive — when a new term
shows up, apply the test, don't grep this list:

> codec · container · decode / encode · transcode · stream-copy · remux · mux / demux ·
> ingest · parse / parser · fingerprint · frame / keyframe · bitrate · WebGL ·
> WebCodecs · service worker · worker · PWA · MSE · File System Access · ponyfill ·
> RAM · buffer · blob · GPMF · telemetry · sidecar

Say the outcome instead:

| Don't say (implementation)        | Say (outcome)                              |
| --------------------------------- | ------------------------------------------ |
| "failed to decode this codec"     | "can't play this video"                    |
| "GPMF telemetry / sidecar data"   | "GPS data", "offline data"                 |
| "the container"                   | "the file"                                 |
| "out of RAM / buffer overflow"    | "this video is too large for your browser" |
| "ingesting / parsing the folder"  | "reading your recordings"                  |

Technical words are allowed in exactly four places:

1. The **feedback diagnostic report body** — it is sent to us, so jargon there is
   fine and useful.
2. Where the term **is the control the user already sees and acts on** —
   "resolution", "GPS". If it is a labelled button or option in front of them, name
   it; if it is something happening under the hood, don't.
3. **Self-help troubleshooting where the exact term is the user's key to fixing it
   themselves.** The "map needs WebGL" guide (i18n `map.unavailable.*` /
   `webglEnable.*`, `ui/webgl-enable-modal.ts`) names **WebGL** on purpose: it is
   the searchable word that matches the browser's own settings, `chrome://gpu`
   ("WebGL: Hardware accelerated") and get.webgl.org. Hiding it behind "the map's
   graphics" would strip the one keyword that lets a user diagnose and fix it. The
   bar is high — this applies only when the term is genuinely the user's lever, not
   whenever it is convenient. Pair the jargon with the plain fix ("WebGL is off
   because hardware acceleration is disabled — turn it on").
4. An **explicit, opt-in "technical details" surface** the user deliberately opens
   to inspect a file — the per-clip details panel (i18n `fileDetails.*`,
   `ui/file-details.ts`), opened by the "i" toggle on a clip row. This is a
   power-user / analysis affordance, the on-screen analogue of the feedback report
   body: codec, container, bitrate, fps belong here because naming the thing
   precisely IS the point. The bar stays high — this covers a labelled, user-invoked
   details view, NOT the everyday sidebar / player copy, which stays plain. The row
   a driver sees by default still says the outcome; the jargon lives one click in.

---

## Product vocabulary

The product calls its own parts by consistent names. Code names and user-facing names
are not always the same — the table fixes the **user-facing** word. English is
canonical; the note flags where the choice of word (not just the translation) matters.

The product name is always **`dashcamigo`**, lowercase — even at the start of a
sentence. Never "Dashcamigo", "DashCamigo", or "DASHCAMIGO".

| Concept                                   | Use (English)   | Note                                                            |
| ----------------------------------------- | --------------- | -------------------------------------------------------------- |
| the whole stitched drive                  | **trip**        | RU "поездка". Never "session" or "video" for the whole drive   |
| one short raw file off the SD card        | **clip**        | the 1–3 min source file; clips join into a trip                |
| the source videos in general              | **recording(s)**| RU "запись"                                                    |
| one physical view (front/rear/interior)   | **camera**      | user-facing word. "channel" is the **internal** name — do not surface it in UI |
| the line drawn on the map                 | **route**       | RU "маршрут" — the visual path                                 |
| the GPS data / `.gpx`                     | **(GPS) track** | RU "трек" — the data, as opposed to the drawn route            |
| speed over time                           | **speed chart** |                                                                |
| an auto-detected hard brake / impact      | **event**       | plain word, not "G-spike" or "G-load threshold"                |
| the whole-trip scrubber                   | **timeline**    | one timeline spans the trip, not per-file                      |
| speed / coords / mini-map drawn on frame  | **overlay**     | "burn onto the frame" is fine in copy                          |
| cut by time / cut by frame                | **trim / crop** | trim = time range, crop = frame area — keep them distinct      |
| save the result to a file                 | **export / save** |                                                              |

Known drift to respect going forward (not yet fixed in the dictionaries): a few UI
strings still say "channel" to the user ("Channel layout", "Active channel large",
"Channel {n}"). New copy uses **camera**.

Accepted second meaning of **clip**: inside the export panel (`export.range.*`,
`event.popup.export`, the export hotkeys), "clip" is the trimmed piece the user is
about to save, not the raw source file. Both senses stay; the export-panel copy is
consistent within itself, so keep using "clip" there rather than inventing a third
term.

---

## Errors

**An error message never exposes a raw browser exception.** No `Error: <raw>`
passthrough. Map every failure to a localized message that says, in plain words,
two things: *what happened* and *what to do next*.

- If there genuinely is no next step the user can take, point them at feedback —
  "something broke on our side; if it keeps happening, tell us" — never a dead end and
  never a raw stack.
- Log the raw cause to the ring buffer (the unscrubbed local record). Show the human
  message.
- Implementation pattern: friendly `*.error.*` keys + classifier predicates
  (`isQuotaExceededError`, `isAllocationFailure`, …). The export `onError` hook takes
  an `I18nKey` (+ params), **never a resolved string**, so the message re-localizes
  when the user switches language mid-session.

A good error tells the driver what to do:

| Raw / unhelpful                        | On-voice                                             |
| -------------------------------------- | ---------------------------------------------------- |
| `RangeError: allocation failed`        | "This video is too large for your browser — try desktop Chrome." |
| "Decode error 0x80004005"              | "Can't play this video. Send us a sample and we'll look into it." |
| "NotAllowedError"                      | "Couldn't save the file — the download was blocked." |

---

## Register

**Short, direct, warm, second person. Never corporate.** No buzzwords. "Corporate" is
the register to flee from:

| Corporate (avoid)                          | On-voice (use)                          |
| ------------------------------------------ | --------------------------------------- |
| "We apologize for any inconvenience."      | "Sorry — that didn't work."             |
| "We were unable to process your request."  | "Couldn't open this file."              |
| "Please be advised that…"                  | (just say the thing)                    |

No decorative emoji. A functional marker — a warning ⚠, a checkmark ✓ — is fine where
it genuinely adds meaning and reads the same in every locale; it is part of the
message, not local seasoning.

Match the register each locale already uses:

- **Product UI is informal** — RU "ты", FR "tu", DE "du", and the equivalent in every
  other language that distinguishes.
- **The landing-page FAQ is formal** where the language draws the line — FR "vous".

When unsure of the register for a new string, read the neighbouring keys in the same
dictionary and the same section, and match them. Consistency within a screen beats a
rule applied in isolation.

---

## Typography

**Punctuation is deliberate brand voice in product copy. Do NOT normalize it to
ASCII.** These are intentional and stay as-is:

> em-dash (—) · middot (·) · arrow (→) · ≈ · ± · non-breaking hyphen

The "plain hyphens / straight quotes" habit applies to chat messages and git commit
messages — **not** to UI strings or landing copy. In a dictionary value, an em-dash is
the right character, not a thing to fix.

---

## Marketing & SEO pages

The vendor and competitor pages (`/cameras/<vendor>`, `/alternatives/<competitor>`,
and the content in `vite-plugins/*`) play by adjacent rules:

- **Adapted per language, not translated word-for-word** — they should read like
  native marketing copy in each locale.
- **Factually faithful to the English source.** Product and competitor names, dates,
  and comparison verdicts match the English. Adaptation is about phrasing, never about
  the facts.
- **Not subject to the plain-language simplification above.** That rule targets the
  product UI. Marketing copy may use precise terms where they belong.
- A new locale string still ships **at the same time** as the English (baseline
  invariant — see CLAUDE.md → Localization).

---

## Never talk the user out of dashcamigo

An honest competitor comparison is fine — it builds trust. But never close on a flat
concession.

Frame a coverage gap — an unsupported camera, an unread GPS format — as an
**invitation**, not a dead end:

> "If dashcamigo doesn't read your camera yet, send a sample to
> feedback@dashcamigo.app — we add formats from real recordings."

This is true (formats genuinely are added from real samples) and on-voice. A coverage
gap is a reason to get in touch, not a reason to leave.

---

## Process

- **Both strings land in the same PR.** When you add a key, the Russian and the
  English ship together — never "we'll localize later". Community locales follow under
  the same baseline rule.
- **English carries the same tone as Russian.** They are two expressions of one voice,
  not a source and a watered-down copy.
- **Verify both languages before merging a UI feature** — toggle the language, or set
  `localStorage["dashcamigo:lang"] = "en"` and reload, and read the actual screens.
- An unfinished translation is **deferred work**, not "routine". Typecheck catches a
  *missing* key; it does not catch a value copied verbatim from `en.ts`. Every such
  placeholder must sit under a `// TODO i18n:` next to the key so grep can find it
  (CLAUDE.md → Deferred work).

# Changelog

<!-- Generated from src/changelog/entries.ts by scripts/generate-changelog-md.mjs.
     Do not edit by hand - edit the entries and regenerate: npm run generate:changelog -->

User-facing changes, newest first. Dates are when the change landed on
[beta](https://beta.dashcamigo.app); production picks it up with the next
release tag. Localized texts ship inside the app (the "What's new" panel).

## 2026-08-29

- **Improved:** Improved storage and synchronization of trip notes, favorites, and markers.
- **New:** Map markers can now use different vehicles, colors, and sizes.

## 2026-08-28

- **Fixed:** Zoomed charts now show a button to return to the full timeline.
- **New:** GPX tracks can now be previewed before assigning them to trips.

## 2026-08-27

- **Improved:** Improved GPS sync.
- **Fixed:** HEVC recordings no longer show as unsupported when the browser can play them.
- **New camera support:** Recordings from Botslab G300H, JOOYFACT A1, MiVue 955WD Pro, and similar models are now supported.

## 2026-08-26

- **New:** Multiple GPX tracks can now be matched to individual clips.

## 2026-08-24

- **New camera support:** Sony HDR-AS30V recordings now show their GPS track and speed.

## 2026-08-23

- **New:** GPS tracks can now be synced with video separately for each trip.
- **Fixed:** Fullscreen now follows the selected theme.
- **Fixed:** Notes files no longer overwrite changes from other tabs or browser profiles.
- **Improved:** More license plates are now found automatically.

## 2026-08-22

- **Fixed:** Improved blur handling during export.
- **Improved:** Trips now appear before recording checks finish, with progress shown in the list.
- **Fixed:** Renamed 70mai and Juscar recordings now keep their GPS tracks; invalid dates or coordinates are skipped instead of shifting the route.

## 2026-08-21

- **Improved:** The map now switches to a backup source when the primary source is unavailable.

## 2026-08-19

- **Improved:** Localization has been improved.

## 2026-08-18

- **Fixed:** RedTiger and FitCamX two-camera recordings now join the front and rear cameras into one trip instead of two separate ones.
- **New camera support:** Navitel recordings in .TS files now show their GPS track, with correct speed and direction.

## 2026-08-15

- **Fixed:** Picking a whole memory card or drive now shows it as one source with its real name.
- **Improved:** When a video can't be played in your browser (often HEVC on Windows), the player now explains why and shows how to fix it.
- **Fixed:** Fixed false speed spikes on the speed chart for 70mai 4K (A810, M500).
- **New:** Street and place names on the map are now adjustable — a gear right on the map sets the text size and how many street names to show.

## 2026-08-14

- **Fixed:** Fixed playback of some kinds of .ts recordings.
- **New camera support:** Added support for new recording folder and file layouts.

## 2026-08-11

- **Fixed:** Fixed GPS for 70mai 4K cameras (A810, M500): routes were drawn tens of kilometers off to the side — open your folder again and the track lands on the road you actually drove.

## 2026-08-08

- **Fixed:** Right after an update rolls out, the app could get stuck reloading in a loop — now it waits a moment and picks up the new version cleanly.
- **Fixed:** Expanding the map in a narrow window — a foldable or a tablet in portrait — no longer hides the video: the trip list steps aside instead.
- **Improved:** The folder warning on iPhone and iPad now points to the faster ways in — a computer, or copying the files you need into the Files app first.
- **New:** dashcamigo now tells you what's new — the sparkles button up top lights up when something fresh lands.
- **New camera support:** Beferich dashcams are now supported — the GPS track is read straight from the video files.

## 2026-08-07

- **Improved:** On iPhone and iPad, picking a folder now warns that it copies your recordings — and offers picking just the files you need.

## 2026-08-04

- **Improved:** Trip names, notes and markers save to a notes file next to your recordings and load back on their own.
- **New:** Settings now show how much space the recordings cache takes — with a size limit and one-click clearing.
- **New:** Speed, coordinates and GPS status get their own row under the player — hide it from the view menu if you don't need it.

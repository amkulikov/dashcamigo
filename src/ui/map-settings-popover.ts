// Gear popover on the big map: map view preferences at the point of use, so
// the user tweaks label size and street-name density while looking at the
// labels. New map-scoped settings land here as more rows. The settings modal
// carries the same preferences for users who never expand the big map - both
// read the same stored values, and the modal re-syncs its selects on open.
//
// Open/close mirrors the other backdrop-less popovers (lang switcher, overflow
// bar): the hidden attribute, outside click and Escape close.

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { syncGpsSyncLaunchers } from "./gps-sync-controls.js";
import {
    getMapLabelScale,
    getStreetLabelDensity,
    MAP_LABEL_SCALE_VALUES,
    setMapLabelScale,
    setStreetLabelDensity,
    STREET_LABEL_DENSITY_LABEL_KEYS,
    STREET_LABEL_DENSITY_VALUES,
} from "./map-label-scale.js";
import { renderMapMarkerControl } from "./map-marker-control.js";
import { getMapMarkerAppearance, setMapMarkerAppearance } from "./map-marker-pref.js";
import { reapplyMapLabelPrefs } from "./map.js";

// Segment buttons carry their preset in data-value; a click persists it,
// restyles the live maps, and re-marks the pressed button. Selection keeps
// the popover open: the map behind it restyles immediately, so the user
// compares variants live instead of reopening the menu per attempt.
function renderSegment<Value extends string | number>(
    host: HTMLElement,
    values: readonly Value[],
    current: Value,
    labelOf: (value: Value) => string,
    apply: (value: Value) => void,
): void {
    host.innerHTML = "";
    for (const value of values) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-settings-seg-btn";
        btn.dataset.value = String(value);
        btn.textContent = labelOf(value);
        btn.setAttribute("aria-pressed", String(value === current));
        btn.addEventListener("click", () => {
            apply(value);
            reapplyMapLabelPrefs();
            for (const child of host.children) {
                child.setAttribute("aria-pressed", String((child as HTMLElement).dataset.value === String(value)));
            }
        });
        host.appendChild(btn);
    }
}

// Rendered fresh on every open so the pressed states reflect preferences
// changed elsewhere (the settings modal selects).
function renderRows(): void {
    syncGpsSyncLaunchers();
    renderMapMarkerControl(dom.mapMarkerControl, {
        appearance: getMapMarkerAppearance(),
        onChange: setMapMarkerAppearance,
        idPrefix: "map-popover",
        compact: true,
    });
    renderSegment(
        dom.mapLabelScaleSegment,
        MAP_LABEL_SCALE_VALUES,
        getMapLabelScale(),
        (scale) => `${Math.round(scale * 100)}%`,
        setMapLabelScale,
    );
    renderSegment(
        dom.mapStreetNamesSegment,
        STREET_LABEL_DENSITY_VALUES,
        getStreetLabelDensity(),
        (density) => t(STREET_LABEL_DENSITY_LABEL_KEYS[density]),
        setStreetLabelDensity,
    );
}

const POPOVER_EDGE_MARGIN_PX = 8;

// The pane (.map-wrap) is overflow:hidden, so a popover past its edge is cut,
// not shown - and the pane can be as narrow as the video/map splitter allows.
// Measured against the live pane box on every open (media queries cannot see
// splitter-driven width): default flyout right of the gear, then a panel below
// it, then the presets stacked vertically; the inline max sizes make long
// locale labels wrap and, on an absurdly short pane, scroll instead of clip.
function fitPopoverToPane(): void {
    const pop = dom.mapSettingsPopover;
    pop.classList.remove("map-settings-popover--below", "map-settings-popover--compact");
    pop.style.maxWidth = "";
    pop.style.maxHeight = "";
    const pane = pop.closest(".map-wrap");
    if (!(pane instanceof HTMLElement)) return;
    const paneBox = pane.getBoundingClientRect();
    // +1 slop: scrollWidth/clientWidth round differently at fractional zoom.
    const fits = (): boolean => {
        const box = pop.getBoundingClientRect();
        return (
            box.right <= paneBox.right - POPOVER_EDGE_MARGIN_PX &&
            box.bottom <= paneBox.bottom - POPOVER_EDGE_MARGIN_PX &&
            pop.scrollWidth <= pop.clientWidth + 1 &&
            pop.scrollHeight <= pop.clientHeight + 1
        );
    };
    if (fits()) return;
    pop.classList.add("map-settings-popover--below");
    pop.style.maxWidth = `${Math.floor(paneBox.right - POPOVER_EDGE_MARGIN_PX - pop.getBoundingClientRect().left)}px`;
    if (fits()) return;
    pop.classList.add("map-settings-popover--compact");
    if (fits()) return;
    pop.style.maxHeight = `${Math.floor(paneBox.bottom - POPOVER_EDGE_MARGIN_PX - pop.getBoundingClientRect().top)}px`;
}

function openPopover(): void {
    renderRows();
    dom.mapSettingsPopover.hidden = false;
    dom.mapSettingsToggle.setAttribute("aria-expanded", "true");
    fitPopoverToPane();
}

function closePopover(): void {
    dom.mapSettingsPopover.hidden = true;
    dom.mapSettingsToggle.setAttribute("aria-expanded", "false");
}

/** Wires the gear toggle and the popover's dismiss handlers. Call once at
 *  startup; the popover content itself is (re)rendered on each open. */
export function initMapSettingsPopover(): void {
    dom.mapSettingsToggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (dom.mapSettingsPopover.hidden) openPopover();
        else closePopover();
    });
    // Click outside closes. Clicks inside stay open - see renderSegment.
    document.addEventListener("click", (ev) => {
        if (dom.mapSettingsPopover.hidden) return;
        const target = ev.target;
        if (
            target instanceof Node &&
            (dom.mapSettingsPopover.contains(target) || dom.mapSettingsToggle.contains(target))
        ) {
            return;
        }
        closePopover();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !dom.mapSettingsPopover.hidden) closePopover();
    });
}

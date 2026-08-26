// Manual GPX-to-clip assignment for an ambiguous batch. The dialog pauses only
// sidecar classification; skipping it leaves the recording ingest untouched.

import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { LooseGpxAssignment } from "./loose-gpx-assignment.js";
import type { LooseGpxTarget } from "./loose-gpx.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

interface GpxAssignmentCopy {
    clipLabel: (name: string) => string;
    unassigned: string;
    alreadyHasGps: string;
}

interface GpxAssignmentElements {
    modal: HTMLElement;
    list: HTMLDivElement;
    skip: HTMLButtonElement;
    apply: HTMLButtonElement;
}

interface AssignmentRow {
    file: ClassifiedFile;
    select: HTMLSelectElement;
}

let rows: AssignmentRow[] = [];
let targets: readonly LooseGpxTarget[] = [];
let pendingResolve: ((assignments: LooseGpxAssignment[]) => void) | null = null;
let isInitialized = false;
let elements: GpxAssignmentElements | null = null;

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`element #${id} not found`);
    return element as T;
}

function assignmentElements(): GpxAssignmentElements {
    return {
        modal: requireElement("gpx-assignment-modal"),
        list: requireElement("gpx-assignment-list"),
        skip: requireElement("gpx-assignment-skip"),
        apply: requireElement("gpx-assignment-apply"),
    };
}

function displayPath(file: ClassifiedFile): string {
    return file.file.relativePath || file.file.file.name;
}

function settle(assignments: LooseGpxAssignment[]): void {
    if (!elements) return;
    elements.modal.hidden = true;
    deactivateModal(elements.modal);
    rows = [];
    targets = [];
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(assignments);
}

function skipAll(): void {
    settle([]);
}

/** A clip accepts at most one GPX in one dialog. This prevents an accidental
 *  merged route while still letting the user leave any track unassigned. */
function syncChoices(): void {
    const selected = new Set(rows.map((row) => row.select.value).filter((value) => value !== ""));
    for (const row of rows) {
        for (const option of Array.from(row.select.options)) {
            if (option.value === "") continue;
            const target = targets[Number(option.value)];
            option.disabled =
                target?.hasGps === true || (selected.has(option.value) && row.select.value !== option.value);
        }
    }
    if (elements) elements.apply.disabled = selected.size === 0;
}

function applyAssignments(): void {
    const assignments: LooseGpxAssignment[] = [];
    for (const row of rows) {
        if (row.select.value === "") continue;
        const target = targets[Number(row.select.value)];
        if (target && !target.hasGps) assignments.push({ file: row.file, target });
    }
    settle(assignments);
}

function renderRows(files: readonly ClassifiedFile[], copy: GpxAssignmentCopy): void {
    if (!elements) return;
    const list = elements.list;
    list.replaceChildren();
    rows = files.map((file, rowIndex) => {
        const label = document.createElement("label");
        label.className = "gpx-assignment-row";

        const path = document.createElement("code");
        path.className = "gpx-assignment-path";
        path.textContent = displayPath(file);

        const arrow = document.createElement("span");
        arrow.className = "gpx-assignment-arrow";
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");

        const select = document.createElement("select");
        select.className = "gpx-assignment-select";
        select.id = `gpx-assignment-select-${rowIndex}`;
        select.setAttribute("aria-label", copy.clipLabel(file.file.file.name));

        const unassigned = document.createElement("option");
        unassigned.value = "";
        unassigned.textContent = copy.unassigned;
        select.appendChild(unassigned);

        for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
            const target = targets[targetIndex]!;
            const option = document.createElement("option");
            option.value = String(targetIndex);
            option.textContent = target.hasGps ? `${target.label} · ${copy.alreadyHasGps}` : target.label;
            option.disabled = target.hasGps;
            select.appendChild(option);
        }
        select.addEventListener("change", syncChoices);

        label.append(path, arrow, select);
        list.appendChild(label);
        return { file, select };
    });
    syncChoices();
}

/** Shows every unassigned GPX and resolves with only the rows the user chose.
 *  A second open settles the earlier promise as skipped before replacing it. */
export function showGpxAssignmentModal(
    files: readonly ClassifiedFile[],
    availableTargets: readonly LooseGpxTarget[],
    copy: GpxAssignmentCopy,
): Promise<LooseGpxAssignment[]> {
    initGpxAssignmentModal();
    if (pendingResolve) settle([]);
    targets = availableTargets;
    renderRows(files, copy);
    elements!.modal.hidden = false;

    return new Promise<LooseGpxAssignment[]>((resolve) => {
        pendingResolve = resolve;
        activateModal(elements!.modal, {
            onClose: skipAll,
            initialFocus: rows[0]?.select ?? elements!.skip,
        });
    });
}

function initGpxAssignmentModal(): void {
    if (isInitialized) return;
    isInitialized = true;
    elements = assignmentElements();
    elements.skip.addEventListener("click", skipAll);
    elements.apply.addEventListener("click", applyAssignments);
    wireBackdropDismiss(elements.modal, skipAll, { cardSelector: ".gpx-assignment-card" });
}

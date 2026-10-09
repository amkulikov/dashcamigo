import { createLogger } from "../log.js";
import { importPortableNotesBackup } from "./annotations-sidecar.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { notify } from "./notifications.js";

const log = createLogger("migration-restore");

export function initMigrationRestore(): void {
    const modal = document.getElementById("migration-restore-modal");
    const input = document.getElementById("migration-restore-input") as HTMLInputElement | null;
    const choose = document.getElementById("migration-restore-choose") as HTMLButtonElement | null;
    if (!modal || !input || !choose) return;
    const close = (): void => {
        modal.hidden = true;
        deactivateModal(modal);
    };
    const open = (): void => {
        if (location.hash !== "#restore-notes") return;
        history.replaceState(history.state, "", location.pathname + location.search);
        modal.hidden = false;
        activateModal(modal, { onClose: close, initialFocus: choose });
    };
    choose.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        choose.disabled = true;
        try {
            if (await importPortableNotesBackup(file)) close();
        } catch (err) {
            log.warn("notes restore failed", { err: err instanceof Error ? err.message : String(err) });
            notify({ severity: "error", messageKey: "sidecar.importFailed" });
        } finally {
            choose.disabled = false;
        }
    });
    document.getElementById("migration-restore-close")?.addEventListener("click", close);
    wireBackdropDismiss(modal, close, { cardSelector: ".export-modal-card" });
    window.addEventListener("hashchange", open);
    open();
}

import { downloadBlob } from "../download.js";
import { createLogger } from "../log.js";
import { notesBackupFilename } from "../persist/annotations.js";
import {
    applyMigrationLanguage,
    isMigrationLanguage,
    migrationLanguage,
    migrationText,
    type MigrationLang,
} from "./i18n.js";
import { readNotesBackup } from "./read-annotations.js";
import "../styles/tokens.css";
import "./style.css";

const log = createLogger("migrate");
const status = document.getElementById("migration-status")!;
const download = document.getElementById("migration-download") as HTMLButtonElement;
const retry = document.getElementById("migration-retry") as HTMLButtonElement;
const language = document.getElementById("migration-language") as HTMLSelectElement;
let lang: MigrationLang = migrationLanguage();
let state: "loading" | "ready" | "empty" | "error" | "saved" | "downloadError" = "loading";
let backup: string | null = null;

function render(): void {
    applyMigrationLanguage(lang);
    status.textContent = migrationText(lang, state);
    status.dataset.state = state;
    download.hidden = backup === null;
    retry.hidden = state !== "error";
}

async function read(): Promise<void> {
    state = "loading";
    backup = null;
    render();
    try {
        backup = await readNotesBackup();
        state = backup === null ? "empty" : "ready";
    } catch (err) {
        log.warn("notes recovery read failed", { err: err instanceof Error ? err.message : String(err) });
        state = "error";
    }
    render();
}

language.value = lang;
language.addEventListener("change", () => {
    if (!isMigrationLanguage(language.value)) return;
    lang = language.value;
    render();
});
document.getElementById("migration-origin")!.textContent = location.host;
retry.addEventListener("click", () => void read());
download.addEventListener("click", () => {
    if (backup === null) return;
    try {
        // Prepare before the click so downloads retain the user's gesture.
        downloadBlob(new Blob([backup], { type: "application/json" }), notesBackupFilename());
        state = "saved";
    } catch (err) {
        log.warn("notes recovery download failed", { err: err instanceof Error ? err.message : String(err) });
        state = "downloadError";
    }
    render();
});
void read();

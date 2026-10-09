type MigrationSource = "apex" | "ru";

const SOURCE_KEY = "everydashcam:migration:source";
const DISMISSED_PREFIX = "everydashcam:migration:dismissed:";

export function migrationAddress(hostname: string): "old" | "new" | null {
    if (/^(?:(?:www|ru|beta)\.)?everydashcam\.app$/.test(hostname)) return "new";
    if (/^(?:(?:www|ru|beta)\.)?dashcamigo\.app$/.test(hostname)) return "old";
    return null;
}

function isSource(value: string | null): value is MigrationSource {
    return value === "apex" || value === "ru";
}

function readSession(key: string): string | null {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeSession(key: string, value: string): void {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // The visible notice still works when browser storage is unavailable.
    }
}

function readSource(params = new URLSearchParams(location.search)): MigrationSource | null {
    const incoming = params.getAll("dc_from").at(-1) ?? null;
    if (isSource(incoming)) return incoming;
    const stored = readSession(SOURCE_KEY);
    return isSource(stored) ? stored : null;
}

export function migrationRecoveryUrl(): string {
    const source = readSource();
    const isRu = source === "ru" || (source === null && location.hostname === "ru.everydashcam.app");
    return isRu ? "https://ru.dashcamigo.app/migrate/" : "https://dashcamigo.app/migrate/";
}

export function initMigrationBanner(onTransfer: () => void): void {
    if (migrationAddress(location.hostname) !== "new") return;
    const banner = document.getElementById("migration-banner");
    if (!banner) return;

    const params = new URLSearchParams(location.search);
    const source = readSource(params);
    if (source) writeSession(SOURCE_KEY, source);
    if (params.has("dc_from")) {
        // Keep unrelated query bytes intact, including repeated keys and encoding.
        const query = location.search
            .slice(1)
            .split("&")
            .filter((part) => !new URLSearchParams(part).has("dc_from"))
            .join("&");
        history.replaceState(history.state, "", location.pathname + (query ? `?${query}` : "") + location.hash);
    }
    if (!isSource(source)) return;

    const dismissedKey = DISMISSED_PREFIX + source;
    let isDismissed = readSession(dismissedKey) === "1";
    try {
        isDismissed ||= localStorage.getItem(dismissedKey) === "1";
    } catch {
        // Session storage retains acknowledgment when persistent storage is blocked.
    }
    if (isDismissed) return;

    const dismiss = (): void => {
        banner.hidden = true;
        writeSession(dismissedKey, "1");
        try {
            localStorage.setItem(dismissedKey, "1");
        } catch {
            // Closing the notice must not depend on persistent storage.
        }
    };

    document.getElementById("migration-banner-dismiss")?.addEventListener("click", dismiss);
    document.getElementById("migration-banner-transfer")?.addEventListener("click", () => {
        dismiss();
        onTransfer();
    });
    banner.hidden = false;
}

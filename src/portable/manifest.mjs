import { isReleaseTag, portableFilename } from "./release-tags.mjs";

export const PORTABLE_PRIMARY_ORIGIN = "https://dashcamigo.app";
export const PORTABLE_UPDATE_URL = `${PORTABLE_PRIMARY_ORIGIN}/downloads/portable/latest.json`;
export const PORTABLE_MAX_BYTES = 25 * 1024 * 1024;

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsePortableManifest(value, allowDevelopment = false, allowCustom = false) {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.files)) return null;
    if (value.distribution !== "public" && !(allowCustom && value.distribution === "custom")) return null;
    const version = value.version;
    if (
        !isReleaseTag(version) &&
        !(allowDevelopment && typeof version === "string" && /^dev-[a-f0-9]{7,40}(?:-dirty)?$/.test(version))
    )
        return null;
    const entries = Object.entries(value.files);
    if (entries.length === 0 || entries.length > 100) return null;
    const files = {};
    for (const [locale, file] of entries) {
        if (!/^[a-z]{2}$/.test(locale) || !isRecord(file)) return null;
        const filename = portableFilename(version, locale);
        const path = `/downloads/portable/${version}/${filename.replace(/\.html$/, "")}`;
        if (
            file.filename !== filename ||
            file.path !== path ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes <= 0 ||
            file.bytes > PORTABLE_MAX_BYTES ||
            typeof file.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(file.sha256)
        )
            return null;
        files[locale] = { path, filename, bytes: file.bytes, sha256: file.sha256 };
    }
    return { schemaVersion: 1, distribution: value.distribution, version, files };
}

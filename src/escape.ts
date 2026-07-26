// Minimal HTML/XML escape for text nodes and attributes. Single project-wide
// helper to prevent ad-hoc implementations and ensure user-controlled data
// (filename, CSV field[9])
// is always sanitized before being written to innerHTML/setHTML.
//
// Replaces exactly the five characters dangerous to the HTML parser: '&', '<',
// '>', '"', "'". Coordinates, numbers, and localized timestamps pass through.

/**
 * HTML-escape for interpolation into innerHTML / Popup.setHTML etc.
 * Covers attributes too - quotes are escaped.
 */
export function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * XML-escape: equivalent to the HTML variant but "'" → "&apos;" (valid only
 * in XML 1.0). Used in GPX serialization.
 */
export function escapeXml(s: string): string {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

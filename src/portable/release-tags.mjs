const RELEASE_TAG_RE = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

export function isReleaseTag(value) {
    if (typeof value !== "string") return false;
    const match = RELEASE_TAG_RE.exec(value);
    if (!match) return false;
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    return (
        Number.isFinite(parsed.valueOf()) &&
        parsed.toISOString().slice(0, 10) === date &&
        (match[4] === undefined || Number.isSafeInteger(Number(match[4])))
    );
}

/** Date segments and same-day revisions sort numerically, including .10 after .2. */
export function compareReleaseTags(a, b) {
    const aSegments = a.slice(1).split(".").map(Number);
    const bSegments = b.slice(1).split(".").map(Number);
    for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
        const difference = (aSegments[i] ?? -1) - (bSegments[i] ?? -1);
        if (difference !== 0) return difference;
    }
    return 0;
}

export function portableFilename(version, locale) {
    if (!/^[a-z]{2}$/.test(locale)) throw new Error("invalid portable locale");
    if (isReleaseTag(version)) {
        const date = version.slice(1).replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
        return `dashcamigo-${date}-${locale}.html`;
    }
    if (!/^dev-[a-f0-9]{7,40}(?:-dirty)?$/.test(version)) throw new Error("invalid portable version");
    return `dashcamigo-${version}-${locale}.html`;
}

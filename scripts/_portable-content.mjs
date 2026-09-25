import { gunzipSync } from "node:zlib";

const PAYLOAD_ID = /(?:^|\s)id\s*=\s*(?:"dc-portable-payload"|'dc-portable-payload'|dc-portable-payload(?=\s|>|$))/;
const GZIP_TYPE = /(?:^|\s)type\s*=\s*(?:"application\/gzip"|'application\/gzip'|application\/gzip(?=\s|$))/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Inspect logical content without changing the bytes used for publication integrity. */
export function decodePortableHtml(html) {
    const ids = html.match(new RegExp(PAYLOAD_ID.source, "g"));
    if (!ids) return html;
    const payloads = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter((match) =>
        PAYLOAD_ID.test(match[1]),
    );
    if (ids.length !== 1 || payloads.length !== 1 || !GZIP_TYPE.test(payloads[0][1])) {
        throw new Error("invalid portable gzip payload element");
    }
    const encoded = payloads[0][2].trim();
    if (!encoded || !BASE64.test(encoded)) throw new Error("invalid portable payload base64");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) throw new Error("non-canonical portable payload base64");
    return new TextDecoder("utf-8", { fatal: true }).decode(gunzipSync(bytes));
}

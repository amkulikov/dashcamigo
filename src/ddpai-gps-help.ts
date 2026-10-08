import { RX_DDPAI_NORMAL, RX_DDPAI_GPS_DIR } from "./parsers/filename/_patterns.js";
import type { VendorFile } from "./parsers/types.js";

/** Directory evidence identifies the DDPAI family, never a specific model. */
export function needsDdpaiGpsFolder(file: VendorFile, selectedFiles: readonly VendorFile[]): boolean {
    if (!RX_DDPAI_NORMAL.test(file.file.name)) return false;
    // The UI keeps only the latest selection's inventory. It cannot prove
    // that a previously opened source was missing its GPS directory.
    if (
        !selectedFiles.some(
            (selected) => selected.sourceKey === file.sourceKey && selected.relativePath === file.relativePath,
        )
    )
        return false;
    const videoRoot = /^((?:.*\/)?)200video\//i.exec(file.relativePath);
    if (!videoRoot) return false;
    return !selectedFiles.some(
        (selected) =>
            selected.sourceKey === file.sourceKey &&
            selected.relativePath.startsWith(videoRoot[1]!) &&
            RX_DDPAI_GPS_DIR.test(selected.relativePath) &&
            /\.(?:gpx|git)$/i.test(selected.file.name),
    );
}

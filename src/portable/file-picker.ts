// Portable export already supplies its own RAM sink when native saving is absent.
// Keeping this boundary native-only excludes the hosted service-worker downloader.
export function showSaveFilePicker(
    options: Parameters<NonNullable<Window["showSaveFilePicker"]>>[0],
): Promise<FileSystemFileHandle> {
    if (!window.showSaveFilePicker) throw new Error("native save picker is unavailable");
    return window.showSaveFilePicker(options);
}

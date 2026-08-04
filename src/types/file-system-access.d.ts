// Chromium-only File System Access surface that lib.dom does not declare:
// permission introspection on handles and the local-disk directory picker.
// Everything is optional - Firefox/Safari never ship these (formal negative
// vendor positions), so call sites must feature-check before use.

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

/** One entry of a picker's `types` filter: MIME type -> accepted extensions.
 *  An extension must start with a dot, hold only ASCII alphanumerics plus "+"
 *  and ".", stay within 16 code points and not end in a dot - the picker throws
 *  TypeError otherwise. */
interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
}

interface Window {
    showDirectoryPicker?(options?: {
        id?: string;
        mode?: FileSystemPermissionMode;
        startIn?: FileSystemHandle | string;
    }): Promise<FileSystemDirectoryHandle>;
    /** Returns handles with `read` granted and leaves the picked file alone -
     *  the only way to adopt a file whose contents must survive the pick. */
    showOpenFilePicker?(options?: {
        id?: string;
        startIn?: FileSystemHandle | string;
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: FilePickerAcceptType[];
    }): Promise<FileSystemFileHandle[]>;
    /** Grants `readwrite`, but EMPTIES the selected file before it resolves
     *  (spec: "set entry's binary data to an empty byte sequence") - creating a
     *  file only, never adopting one. */
    showSaveFilePicker?(options?: {
        id?: string;
        suggestedName?: string;
        startIn?: FileSystemHandle | string;
        excludeAcceptAllOption?: boolean;
        types?: FilePickerAcceptType[];
    }): Promise<FileSystemFileHandle>;
}

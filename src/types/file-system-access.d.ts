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

interface Window {
    showDirectoryPicker?(options?: {
        id?: string;
        mode?: FileSystemPermissionMode;
        startIn?: FileSystemHandle | string;
    }): Promise<FileSystemDirectoryHandle>;
}

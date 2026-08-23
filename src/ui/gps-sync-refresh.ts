// Dependency-free fan-out for live GPS calibration. The dialog requests a
// refresh without importing the heavy player/map/chart graph into its module;
// initialized viewer modules register repaint callbacks.

type RefreshListener = () => void;

const listeners = new Set<RefreshListener>();

export function registerGpsSyncRefreshListener(listener: RefreshListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function requestGpsSyncSurfaceRefresh(): void {
    for (const listener of listeners) listener();
}

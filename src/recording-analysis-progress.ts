export interface RecordingAnalysisProgress {
    completed: number;
    total: number;
}

/** The shared status exists only while mandatory recording details remain. */
export function pendingRecordingAnalysisProgress(completed: number, total: number): RecordingAnalysisProgress | null {
    if (total <= 0) return null;
    const boundedCompleted = Math.max(0, Math.min(completed, total));
    return boundedCompleted < total ? { completed: boundedCompleted, total } : null;
}

/** An active pass is unfinished, so rounding must never advertise 100%. */
export function recordingAnalysisPercent(progress: RecordingAnalysisProgress): number {
    if (progress.total <= 0) return 0;
    return Math.max(0, Math.min(99, Math.round((progress.completed / progress.total) * 100)));
}

export const FINISHED_CRONJOB_RUN_STATUSES = ["success", "failed", "terminated", "skipped"] as const;

export function isFinishedCronjobRunStatus(status: string): boolean {
    return (FINISHED_CRONJOB_RUN_STATUSES as readonly string[]).includes(status);
}

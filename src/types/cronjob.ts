export type CronjobTargetType = "prompt" | "workflow";

export type CronjobMonitorTimeoutUnit = "minutes" | "hours" | "days";

export type CronjobSchedule = {
    cron_expression: string;
    timezone: string;
};

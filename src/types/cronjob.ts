export type CronjobTargetType = "prompt" | "workflow";

export type CronjobSchedule = {
    cron_expression: string;
    timezone: string;
};

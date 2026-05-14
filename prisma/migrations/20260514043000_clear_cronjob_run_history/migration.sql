DELETE FROM "cronjob_run_todos";
DELETE FROM "cronjob_runs";

CREATE UNIQUE INDEX "cronjob_runs_one_running_per_cronjob"
ON "cronjob_runs"("cronjob_id")
WHERE "status" = 'running';

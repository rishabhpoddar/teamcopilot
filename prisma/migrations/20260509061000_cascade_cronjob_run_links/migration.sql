-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cronjob_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronjob_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "workflow_run_id" TEXT,
    "summary" TEXT,
    "session_id" TEXT,
    "opencode_session_id" TEXT,
    "error_message" TEXT,
    CONSTRAINT "cronjob_runs_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cronjob_runs" ("completed_at", "cronjob_id", "error_message", "id", "opencode_session_id", "session_id", "started_at", "status", "summary", "workflow_run_id") SELECT "completed_at", "cronjob_id", "error_message", "id", "opencode_session_id", "session_id", "started_at", "status", "summary", "workflow_run_id" FROM "cronjob_runs";
DROP TABLE "cronjob_runs";
ALTER TABLE "new_cronjob_runs" RENAME TO "cronjob_runs";
CREATE INDEX "cronjob_runs_cronjob_id_started_at_idx" ON "cronjob_runs"("cronjob_id", "started_at");
CREATE INDEX "cronjob_runs_cronjob_id_status_idx" ON "cronjob_runs"("cronjob_id", "status");
CREATE INDEX "cronjob_runs_workflow_run_id_idx" ON "cronjob_runs"("workflow_run_id");
CREATE INDEX "cronjob_runs_session_id_idx" ON "cronjob_runs"("session_id");
CREATE INDEX "cronjob_runs_opencode_session_id_status_idx" ON "cronjob_runs"("opencode_session_id", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


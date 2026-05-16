-- CreateTable
CREATE TABLE "cronjob_targets" (
    "cronjob_id" TEXT NOT NULL PRIMARY KEY,
    "target_type" TEXT NOT NULL,
    "prompt" TEXT,
    "prompt_allow_workflow_runs_without_permission" BOOLEAN,
    "workflow_slug" TEXT,
    "workflow_input_json" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "cronjob_targets_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cronjob_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronjob_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "target_type_snapshot" TEXT NOT NULL DEFAULT 'prompt',
    "prompt_snapshot" TEXT,
    "workflow_slug_snapshot" TEXT,
    "workflow_input_snapshot_json" TEXT,
    "workflow_run_id" TEXT,
    "summary" TEXT,
    "session_id" TEXT,
    "opencode_session_id" TEXT,
    "needs_user_input_reason" TEXT,
    "error_message" TEXT,
    CONSTRAINT "cronjob_runs_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_cronjob_runs" ("completed_at", "cronjob_id", "error_message", "id", "needs_user_input_reason", "opencode_session_id", "prompt_snapshot", "session_id", "started_at", "status", "summary") SELECT "completed_at", "cronjob_id", "error_message", "id", "needs_user_input_reason", "opencode_session_id", "prompt_snapshot", "session_id", "started_at", "status", "summary" FROM "cronjob_runs";
DROP TABLE "cronjob_runs";
ALTER TABLE "new_cronjob_runs" RENAME TO "cronjob_runs";
CREATE INDEX "cronjob_runs_cronjob_id_started_at_idx" ON "cronjob_runs"("cronjob_id", "started_at");
CREATE INDEX "cronjob_runs_cronjob_id_status_idx" ON "cronjob_runs"("cronjob_id", "status");
CREATE INDEX "cronjob_runs_workflow_run_id_idx" ON "cronjob_runs"("workflow_run_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "cronjob_targets_target_type_idx" ON "cronjob_targets"("target_type");

-- CreateIndex
CREATE INDEX "cronjob_targets_workflow_slug_idx" ON "cronjob_targets"("workflow_slug");

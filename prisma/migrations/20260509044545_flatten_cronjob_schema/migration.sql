/*
  Warnings:

  - You are about to drop the `cronjob_schedules` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cronjob_targets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `needs_user_input_reason` on the `cronjob_runs` table. All the data in the column will be lost.
  - You are about to drop the column `prompt_snapshot` on the `cronjob_runs` table. All the data in the column will be lost.
  - You are about to drop the column `target_type_snapshot` on the `cronjob_runs` table. All the data in the column will be lost.
  - You are about to drop the column `workflow_input_snapshot_json` on the `cronjob_runs` table. All the data in the column will be lost.
  - You are about to drop the column `workflow_slug_snapshot` on the `cronjob_runs` table. All the data in the column will be lost.
  - You are about to drop the column `allow_workflow_runs_without_permission` on the `cronjobs` table. All the data in the column will be lost.
  - Added the required column `target_type` to the `cronjobs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timezone` to the `cronjobs` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "cronjob_targets_workflow_slug_idx";

-- DropIndex
DROP INDEX "cronjob_targets_target_type_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "cronjob_schedules";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "cronjob_targets";
PRAGMA foreign_keys=on;

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
    CONSTRAINT "cronjob_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_cronjob_runs" ("completed_at", "cronjob_id", "error_message", "id", "opencode_session_id", "session_id", "started_at", "status", "summary", "workflow_run_id") SELECT "completed_at", "cronjob_id", "error_message", "id", "opencode_session_id", "session_id", "started_at", "status", "summary", "workflow_run_id" FROM "cronjob_runs";
DROP TABLE "cronjob_runs";
ALTER TABLE "new_cronjob_runs" RENAME TO "cronjob_runs";
CREATE INDEX "cronjob_runs_cronjob_id_started_at_idx" ON "cronjob_runs"("cronjob_id", "started_at");
CREATE INDEX "cronjob_runs_cronjob_id_status_idx" ON "cronjob_runs"("cronjob_id", "status");
CREATE INDEX "cronjob_runs_workflow_run_id_idx" ON "cronjob_runs"("workflow_run_id");
CREATE TABLE "new_cronjobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "target_type" TEXT NOT NULL,
    "prompt" TEXT,
    "prompt_allow_workflow_runs_without_permission" BOOLEAN,
    "workflow_slug" TEXT,
    "workflow_input_json" TEXT,
    "preset_key" TEXT,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL,
    "schedule_type" TEXT NOT NULL DEFAULT 'cron',
    "time_minutes" INTEGER,
    "days_of_week" TEXT,
    "week_interval" INTEGER,
    "anchor_date" TEXT,
    "day_of_month" INTEGER,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "cronjobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cronjobs" ("created_at", "enabled", "id", "name", "prompt", "updated_at", "user_id") SELECT "created_at", "enabled", "id", "name", "prompt", "updated_at", "user_id" FROM "cronjobs";
DROP TABLE "cronjobs";
ALTER TABLE "new_cronjobs" RENAME TO "cronjobs";
CREATE INDEX "cronjobs_user_id_idx" ON "cronjobs"("user_id");
CREATE INDEX "cronjobs_enabled_idx" ON "cronjobs"("enabled");
CREATE INDEX "cronjobs_target_type_idx" ON "cronjobs"("target_type");
CREATE INDEX "cronjobs_workflow_slug_idx" ON "cronjobs"("workflow_slug");
CREATE UNIQUE INDEX "cronjobs_user_id_name_key" ON "cronjobs"("user_id", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

/*
  Warnings:

  - You are about to drop the column `anchor_date` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `day_of_month` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `days_of_week` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `preset_key` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `schedule_type` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `time_minutes` on the `cronjobs` table. All the data in the column will be lost.
  - You are about to drop the column `week_interval` on the `cronjobs` table. All the data in the column will be lost.
  - Made the column `cron_expression` on table `cronjobs` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "cronjobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cronjobs" ("created_at", "cron_expression", "enabled", "id", "name", "prompt", "prompt_allow_workflow_runs_without_permission", "target_type", "timezone", "updated_at", "user_id", "workflow_input_json", "workflow_slug") SELECT "created_at", "cron_expression", "enabled", "id", "name", "prompt", "prompt_allow_workflow_runs_without_permission", "target_type", "timezone", "updated_at", "user_id", "workflow_input_json", "workflow_slug" FROM "cronjobs";
DROP TABLE "cronjobs";
ALTER TABLE "new_cronjobs" RENAME TO "cronjobs";
CREATE INDEX "cronjobs_user_id_idx" ON "cronjobs"("user_id");
CREATE INDEX "cronjobs_enabled_idx" ON "cronjobs"("enabled");
CREATE INDEX "cronjobs_target_type_idx" ON "cronjobs"("target_type");
CREATE INDEX "cronjobs_workflow_slug_idx" ON "cronjobs"("workflow_slug");
CREATE UNIQUE INDEX "cronjobs_user_id_name_key" ON "cronjobs"("user_id", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

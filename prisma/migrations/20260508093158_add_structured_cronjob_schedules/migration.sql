-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cronjob_schedules" (
    "cronjob_id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "cronjob_schedules_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cronjob_schedules" ("created_at", "cron_expression", "cronjob_id", "preset_key", "timezone", "updated_at") SELECT "created_at", "cron_expression", "cronjob_id", "preset_key", "timezone", "updated_at" FROM "cronjob_schedules";
DROP TABLE "cronjob_schedules";
ALTER TABLE "new_cronjob_schedules" RENAME TO "cronjob_schedules";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

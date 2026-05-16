-- CreateTable
CREATE TABLE "cronjobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "allow_workflow_runs_without_permission" BOOLEAN NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "cronjobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cronjob_schedules" (
    "cronjob_id" TEXT NOT NULL PRIMARY KEY,
    "preset_key" TEXT,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "cronjob_schedules_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cronjob_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronjob_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "prompt_snapshot" TEXT NOT NULL,
    "summary" TEXT,
    "session_id" TEXT,
    "opencode_session_id" TEXT,
    "needs_user_input_reason" TEXT,
    "error_message" TEXT,
    CONSTRAINT "cronjob_runs_cronjob_id_fkey" FOREIGN KEY ("cronjob_id") REFERENCES "cronjobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cronjob_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "last_seen_assistant_message_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "visible_to_user" BOOLEAN NOT NULL DEFAULT true,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("created_at", "id", "last_seen_assistant_message_id", "opencode_session_id", "title", "updated_at", "user_id") SELECT "created_at", "id", "last_seen_assistant_message_id", "opencode_session_id", "title", "updated_at", "user_id" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_opencode_session_id_key" ON "chat_sessions"("opencode_session_id");
CREATE INDEX "chat_sessions_source_visible_to_user_idx" ON "chat_sessions"("source", "visible_to_user");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "cronjobs_user_id_idx" ON "cronjobs"("user_id");

-- CreateIndex
CREATE INDEX "cronjobs_enabled_idx" ON "cronjobs"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "cronjobs_user_id_name_key" ON "cronjobs"("user_id", "name");

-- CreateIndex
CREATE INDEX "cronjob_runs_cronjob_id_started_at_idx" ON "cronjob_runs"("cronjob_id", "started_at");

-- CreateIndex
CREATE INDEX "cronjob_runs_cronjob_id_status_idx" ON "cronjob_runs"("cronjob_id", "status");

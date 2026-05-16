-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "last_seen_assistant_message_id" TEXT,
    "visible_to_user" BOOLEAN NOT NULL DEFAULT true,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("created_at", "id", "last_seen_assistant_message_id", "opencode_session_id", "title", "updated_at", "user_id", "visible_to_user") SELECT "created_at", "id", "last_seen_assistant_message_id", "opencode_session_id", "title", "updated_at", "user_id", "visible_to_user" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_opencode_session_id_key" ON "chat_sessions"("opencode_session_id");
CREATE INDEX "chat_sessions_visible_to_user_idx" ON "chat_sessions"("visible_to_user");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "cronjob_runs_session_id_idx" ON "cronjob_runs"("session_id");

-- CreateIndex
CREATE INDEX "cronjob_runs_opencode_session_id_status_idx" ON "cronjob_runs"("opencode_session_id", "status");


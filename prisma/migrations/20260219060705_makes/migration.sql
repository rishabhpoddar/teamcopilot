/*
  Warnings:

  - Made the column `title` on table `chat_sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("created_at", "id", "opencode_session_id", "title", "updated_at", "user_id") SELECT "created_at", "id", "opencode_session_id", "title", "updated_at", "user_id" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_opencode_session_id_key" ON "chat_sessions"("opencode_session_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

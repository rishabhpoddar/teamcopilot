/*
  Warnings:

  - Made the column `last_synced_message_id` on table `chat_session_usage` required. This step will fail if there are existing NULL values in that column.
  - Made the column `provider_id` on table `chat_session_usage` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_session_usage" (
    "chat_session_id" TEXT NOT NULL PRIMARY KEY,
    "last_synced_message_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cached_tokens" INTEGER NOT NULL,
    "cost_usd" REAL NOT NULL,
    "model_id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_session_usage_chat_session_id_fkey" FOREIGN KEY ("chat_session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_session_usage" ("cached_tokens", "chat_session_id", "cost_usd", "input_tokens", "last_synced_message_id", "model_id", "output_tokens", "provider_id", "updated_at") SELECT "cached_tokens", "chat_session_id", "cost_usd", "input_tokens", "last_synced_message_id", "model_id", "output_tokens", "provider_id", "updated_at" FROM "chat_session_usage";
DROP TABLE "chat_session_usage";
ALTER TABLE "new_chat_session_usage" RENAME TO "chat_session_usage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

/*
  Warnings:

  - You are about to drop the column `metadata` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `patterns` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `tool_name` on the `tool_execution_permissions` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tool_execution_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opencode_session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "responded_at" BIGINT
);
INSERT INTO "new_tool_execution_permissions" ("call_id", "created_at", "id", "message_id", "opencode_session_id", "responded_at", "status") SELECT "call_id", "created_at", "id", "message_id", "opencode_session_id", "responded_at", "status" FROM "tool_execution_permissions";
DROP TABLE "tool_execution_permissions";
ALTER TABLE "new_tool_execution_permissions" RENAME TO "tool_execution_permissions";
CREATE INDEX "tool_execution_permissions_opencode_session_id_status_idx" ON "tool_execution_permissions"("opencode_session_id", "status");
CREATE UNIQUE INDEX "tool_execution_permissions_opencode_session_id_message_id_call_id_key" ON "tool_execution_permissions"("opencode_session_id", "message_id", "call_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

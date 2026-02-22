/*
  Warnings:

  - You are about to drop the column `opencode_permission_id` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - Added the required column `call_id` to the `tool_execution_permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `message_id` to the `tool_execution_permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patterns` to the `tool_execution_permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tool_name` to the `tool_execution_permissions` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tool_execution_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opencode_session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "patterns" TEXT NOT NULL,
    "metadata" TEXT,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "responded_at" BIGINT
);
INSERT INTO "new_tool_execution_permissions" ("created_at", "id", "opencode_session_id", "responded_at", "status") SELECT "created_at", "id", "opencode_session_id", "responded_at", "status" FROM "tool_execution_permissions";
DROP TABLE "tool_execution_permissions";
ALTER TABLE "new_tool_execution_permissions" RENAME TO "tool_execution_permissions";
CREATE INDEX "tool_execution_permissions_opencode_session_id_status_idx" ON "tool_execution_permissions"("opencode_session_id", "status");
CREATE INDEX "tool_execution_permissions_id_status_idx" ON "tool_execution_permissions"("id", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

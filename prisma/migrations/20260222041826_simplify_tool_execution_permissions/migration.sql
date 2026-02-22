/*
  Warnings:

  - You are about to drop the column `call_id` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `message_id` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `params` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - You are about to drop the column `tool_name` on the `tool_execution_permissions` table. All the data in the column will be lost.
  - Added the required column `opencode_permission_id` to the `tool_execution_permissions` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tool_execution_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opencode_permission_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "responded_at" BIGINT
);
INSERT INTO "new_tool_execution_permissions" ("created_at", "id", "opencode_session_id", "responded_at", "status") SELECT "created_at", "id", "opencode_session_id", "responded_at", "status" FROM "tool_execution_permissions";
DROP TABLE "tool_execution_permissions";
ALTER TABLE "new_tool_execution_permissions" RENAME TO "tool_execution_permissions";
CREATE INDEX "tool_execution_permissions_opencode_session_id_status_idx" ON "tool_execution_permissions"("opencode_session_id", "status");
CREATE INDEX "tool_execution_permissions_opencode_permission_id_idx" ON "tool_execution_permissions"("opencode_permission_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

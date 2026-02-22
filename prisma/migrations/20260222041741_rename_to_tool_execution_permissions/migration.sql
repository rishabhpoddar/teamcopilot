/*
  Warnings:

  - You are about to drop the `workflow_execution_permissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflow_execution_permissions";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "tool_execution_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opencode_session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "params" TEXT,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "responded_at" BIGINT
);

-- CreateIndex
CREATE INDEX "tool_execution_permissions_opencode_session_id_status_idx" ON "tool_execution_permissions"("opencode_session_id", "status");

-- CreateIndex
CREATE INDEX "tool_execution_permissions_id_status_idx" ON "tool_execution_permissions"("id", "status");

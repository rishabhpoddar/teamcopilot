/*
  Warnings:

  - You are about to drop the `workflow_run_log_refs` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN "message_id" TEXT;
ALTER TABLE "workflow_runs" ADD COLUMN "session_id" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflow_run_log_refs";
PRAGMA foreign_keys=on;

-- CreateIndex
CREATE INDEX "workflow_runs_session_id_message_id_idx" ON "workflow_runs"("session_id", "message_id");

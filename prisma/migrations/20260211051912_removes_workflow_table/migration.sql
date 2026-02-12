/*
  Warnings:

  - You are about to drop the `workflows` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "workflows_slug_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflows";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ran_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "args" TEXT,
    "error_message" TEXT,
    "workflow_id" TEXT NOT NULL,
    CONSTRAINT "workflow_runs_ran_by_user_id_fkey" FOREIGN KEY ("ran_by_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workflow_runs" ("args", "completed_at", "error_message", "id", "ran_by_user_id", "started_at", "status", "workflow_id") SELECT "args", "completed_at", "error_message", "id", "ran_by_user_id", "started_at", "status", "workflow_id" FROM "workflow_runs";
DROP TABLE "workflow_runs";
ALTER TABLE "new_workflow_runs" RENAME TO "workflow_runs";
CREATE INDEX "workflow_runs_started_at_idx" ON "workflow_runs"("started_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

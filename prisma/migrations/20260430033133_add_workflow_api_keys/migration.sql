-- CreateTable
CREATE TABLE "workflow_api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_slug" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ran_by_user_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "args" TEXT,
    "error_message" TEXT,
    "output" TEXT,
    "workflow_slug" TEXT NOT NULL,
    "session_id" TEXT,
    "message_id" TEXT,
    "run_source" TEXT NOT NULL DEFAULT 'user',
    "workflow_api_key_id" TEXT,
    CONSTRAINT "workflow_runs_ran_by_user_id_fkey" FOREIGN KEY ("ran_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_runs_workflow_api_key_id_fkey" FOREIGN KEY ("workflow_api_key_id") REFERENCES "workflow_api_keys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workflow_runs" ("args", "completed_at", "error_message", "id", "message_id", "output", "ran_by_user_id", "session_id", "started_at", "status", "workflow_slug") SELECT "args", "completed_at", "error_message", "id", "message_id", "output", "ran_by_user_id", "session_id", "started_at", "status", "workflow_slug" FROM "workflow_runs";
DROP TABLE "workflow_runs";
ALTER TABLE "new_workflow_runs" RENAME TO "workflow_runs";
CREATE INDEX "workflow_runs_started_at_idx" ON "workflow_runs"("started_at");
CREATE INDEX "workflow_runs_session_id_message_id_idx" ON "workflow_runs"("session_id", "message_id");
CREATE INDEX "workflow_runs_workflow_api_key_id_idx" ON "workflow_runs"("workflow_api_key_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "workflow_api_keys_api_key_key" ON "workflow_api_keys"("api_key");

-- CreateIndex
CREATE INDEX "workflow_api_keys_workflow_slug_idx" ON "workflow_api_keys"("workflow_slug");

-- CreateIndex
CREATE INDEX "workflow_api_keys_created_by_user_id_idx" ON "workflow_api_keys"("created_by_user_id");

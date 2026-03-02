-- CreateTable
CREATE TABLE "workflow_run_log_refs" (
    "run_id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_run_log_refs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

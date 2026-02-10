-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_slug" TEXT NOT NULL,
    "workflow_name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    "args" TEXT,
    "error_message" TEXT,
    CONSTRAINT "workflow_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workflow_runs_started_at_idx" ON "workflow_runs"("started_at");

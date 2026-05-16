-- CreateTable
CREATE TABLE "cronjob_run_todos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "summary" TEXT,
    "created_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "cronjob_run_todos_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "cronjob_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "cronjob_run_todos_run_id_status_position_idx" ON "cronjob_run_todos"("run_id", "status", "position");

-- CreateIndex
CREATE INDEX "cronjob_run_todos_run_id_position_idx" ON "cronjob_run_todos"("run_id", "position");

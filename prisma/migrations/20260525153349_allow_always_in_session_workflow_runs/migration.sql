-- AlterTable
ALTER TABLE "tool_execution_permissions" ADD COLUMN "workflow_slug" TEXT;

-- CreateTable
CREATE TABLE "workflow_session_allowed_runs" (
    "opencode_session_id" TEXT NOT NULL,
    "workflow_slug" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    PRIMARY KEY ("opencode_session_id", "workflow_slug")
);

-- CreateIndex
CREATE INDEX "workflow_session_allowed_runs_workflow_slug_idx" ON "workflow_session_allowed_runs"("workflow_slug");

-- CreateIndex
CREATE INDEX "tool_execution_permissions_opencode_session_id_workflow_slug_idx" ON "tool_execution_permissions"("opencode_session_id", "workflow_slug");

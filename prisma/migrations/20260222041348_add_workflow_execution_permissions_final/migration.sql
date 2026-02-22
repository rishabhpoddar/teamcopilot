-- CreateTable
CREATE TABLE "workflow_execution_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opencode_session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "workflow_slug" TEXT NOT NULL,
    "args" TEXT,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "responded_at" BIGINT
);

-- CreateIndex
CREATE INDEX "workflow_execution_permissions_opencode_session_id_status_idx" ON "workflow_execution_permissions"("opencode_session_id", "status");

-- CreateIndex
CREATE INDEX "workflow_execution_permissions_id_status_idx" ON "workflow_execution_permissions"("id", "status");

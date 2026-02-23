-- CreateTable
CREATE TABLE "workflow_run_permissions" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "workflow_run_permission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_slug" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_run_permission_users_workflow_slug_fkey" FOREIGN KEY ("workflow_slug") REFERENCES "workflow_run_permissions" ("workflow_slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_run_permission_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workflow_run_permission_users_workflow_slug_idx" ON "workflow_run_permission_users"("workflow_slug");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_run_permission_users_workflow_slug_user_id_key" ON "workflow_run_permission_users"("workflow_slug", "user_id");

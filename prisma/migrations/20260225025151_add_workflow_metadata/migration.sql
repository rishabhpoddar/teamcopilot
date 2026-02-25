-- CreateTable
CREATE TABLE "workflow_metadata" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workflow_metadata_created_by_user_id_idx" ON "workflow_metadata"("created_by_user_id");

-- CreateIndex
CREATE INDEX "workflow_metadata_approved_by_user_id_idx" ON "workflow_metadata"("approved_by_user_id");

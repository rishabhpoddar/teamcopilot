-- CreateTable
CREATE TABLE "workflow_approved_snapshots" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "snapshot_hash" TEXT NOT NULL,
    "file_count" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_approved_snapshots_workflow_slug_fkey" FOREIGN KEY ("workflow_slug") REFERENCES "workflow_metadata" ("workflow_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workflow_approved_snapshot_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_slug" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "content_kind" TEXT NOT NULL,
    "text_content" TEXT,
    "binary_content" BLOB,
    "size_bytes" INTEGER NOT NULL,
    "content_sha256" TEXT NOT NULL,
    CONSTRAINT "workflow_approved_snapshot_files_workflow_slug_fkey" FOREIGN KEY ("workflow_slug") REFERENCES "workflow_approved_snapshots" ("workflow_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workflow_approved_snapshot_files_workflow_slug_idx" ON "workflow_approved_snapshot_files"("workflow_slug");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_approved_snapshot_files_workflow_slug_relative_path_key" ON "workflow_approved_snapshot_files"("workflow_slug", "relative_path");

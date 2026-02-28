/*
  Warnings:

  - You are about to drop the column `workspace_path` on the `workflow_approved_snapshot_files` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_approved_snapshot_files" (
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
INSERT INTO "new_workflow_approved_snapshot_files" ("binary_content", "content_kind", "content_sha256", "id", "relative_path", "size_bytes", "text_content", "workflow_slug") SELECT "binary_content", "content_kind", "content_sha256", "id", "relative_path", "size_bytes", "text_content", "workflow_slug" FROM "workflow_approved_snapshot_files";
DROP TABLE "workflow_approved_snapshot_files";
ALTER TABLE "new_workflow_approved_snapshot_files" RENAME TO "workflow_approved_snapshot_files";
CREATE INDEX "workflow_approved_snapshot_files_workflow_slug_idx" ON "workflow_approved_snapshot_files"("workflow_slug");
CREATE UNIQUE INDEX "workflow_approved_snapshot_files_workflow_slug_relative_path_key" ON "workflow_approved_snapshot_files"("workflow_slug", "relative_path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

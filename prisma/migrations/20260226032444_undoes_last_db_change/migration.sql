/*
  Warnings:

  - You are about to drop the column `is_approved` on the `workflow_metadata` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_metadata" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "run_permission_mode" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workflow_metadata" ("approved_by_user_id", "created_at", "created_by_user_id", "run_permission_mode", "updated_at", "workflow_slug") SELECT "approved_by_user_id", "created_at", "created_by_user_id", "run_permission_mode", "updated_at", "workflow_slug" FROM "workflow_metadata";
DROP TABLE "workflow_metadata";
ALTER TABLE "new_workflow_metadata" RENAME TO "workflow_metadata";
CREATE INDEX "workflow_metadata_created_by_user_id_idx" ON "workflow_metadata"("created_by_user_id");
CREATE INDEX "workflow_metadata_approved_by_user_id_idx" ON "workflow_metadata"("approved_by_user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

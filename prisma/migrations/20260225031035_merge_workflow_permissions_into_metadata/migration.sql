/*
  Warnings:

  - You are about to drop the `workflow_run_permissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflow_run_permissions";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_metadata" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "run_permission_mode" TEXT NOT NULL DEFAULT 'restricted',
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workflow_metadata" ("approved_by_user_id", "created_at", "created_by_user_id", "updated_at", "workflow_slug") SELECT "approved_by_user_id", "created_at", "created_by_user_id", "updated_at", "workflow_slug" FROM "workflow_metadata";
DROP TABLE "workflow_metadata";
ALTER TABLE "new_workflow_metadata" RENAME TO "workflow_metadata";
CREATE INDEX "workflow_metadata_created_by_user_id_idx" ON "workflow_metadata"("created_by_user_id");
CREATE INDEX "workflow_metadata_approved_by_user_id_idx" ON "workflow_metadata"("approved_by_user_id");
CREATE TABLE "new_workflow_run_permission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_slug" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_run_permission_users_workflow_slug_fkey" FOREIGN KEY ("workflow_slug") REFERENCES "workflow_metadata" ("workflow_slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_run_permission_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workflow_run_permission_users" ("created_at", "id", "user_id", "workflow_slug") SELECT "created_at", "id", "user_id", "workflow_slug" FROM "workflow_run_permission_users";
DROP TABLE "workflow_run_permission_users";
ALTER TABLE "new_workflow_run_permission_users" RENAME TO "workflow_run_permission_users";
CREATE INDEX "workflow_run_permission_users_workflow_slug_idx" ON "workflow_run_permission_users"("workflow_slug");
CREATE UNIQUE INDEX "workflow_run_permission_users_workflow_slug_user_id_key" ON "workflow_run_permission_users"("workflow_slug", "user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

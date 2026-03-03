/*
  Warnings:

  - You are about to drop the `skill_access_permission_users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflow_run_permission_users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `access_permission_mode` on the `skill_metadata` table. All the data in the column will be lost.
  - You are about to drop the column `run_permission_mode` on the `workflow_metadata` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "resource_permissions" (
    "resource_kind" TEXT NOT NULL,
    "resource_slug" TEXT NOT NULL,
    "permission_mode" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    PRIMARY KEY ("resource_kind", "resource_slug")
);

-- CreateTable
CREATE TABLE "resource_permission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_kind" TEXT NOT NULL,
    "resource_slug" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "resource_permission_users_resource_kind_resource_slug_fkey" FOREIGN KEY ("resource_kind", "resource_slug") REFERENCES "resource_permissions" ("resource_kind", "resource_slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_permission_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill workflow permissions into unified tables
INSERT INTO "resource_permissions" ("resource_kind", "resource_slug", "permission_mode", "created_at", "updated_at")
SELECT "workflow", "workflow_slug", "run_permission_mode", "created_at", "updated_at"
FROM "workflow_metadata";

INSERT INTO "resource_permission_users" ("id", "resource_kind", "resource_slug", "user_id", "created_at")
SELECT "wf-" || "id", "workflow", "workflow_slug", "user_id", "created_at"
FROM "workflow_run_permission_users";

-- Backfill skill permissions into unified tables
INSERT INTO "resource_permissions" ("resource_kind", "resource_slug", "permission_mode", "created_at", "updated_at")
SELECT "skill", "skill_slug", "access_permission_mode", "created_at", "updated_at"
FROM "skill_metadata";

INSERT INTO "resource_permission_users" ("id", "resource_kind", "resource_slug", "user_id", "created_at")
SELECT "sk-" || "id", "skill", "skill_slug", "user_id", "created_at"
FROM "skill_access_permission_users";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_skill_metadata" (
    "skill_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "skill_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_skill_metadata" ("approved_by_user_id", "created_at", "created_by_user_id", "skill_slug", "updated_at") SELECT "approved_by_user_id", "created_at", "created_by_user_id", "skill_slug", "updated_at" FROM "skill_metadata";
DROP TABLE "skill_metadata";
ALTER TABLE "new_skill_metadata" RENAME TO "skill_metadata";
CREATE INDEX "skill_metadata_created_by_user_id_idx" ON "skill_metadata"("created_by_user_id");
CREATE INDEX "skill_metadata_approved_by_user_id_idx" ON "skill_metadata"("approved_by_user_id");
CREATE TABLE "new_workflow_metadata" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Drop old permission tables after successful backfill
PRAGMA foreign_keys=off;
DROP TABLE "skill_access_permission_users";
DROP TABLE "workflow_run_permission_users";
PRAGMA foreign_keys=on;

-- CreateIndex
CREATE INDEX "resource_permissions_resource_slug_idx" ON "resource_permissions"("resource_slug");

-- CreateIndex
CREATE INDEX "resource_permission_users_resource_kind_resource_slug_idx" ON "resource_permission_users"("resource_kind", "resource_slug");

-- CreateIndex
CREATE UNIQUE INDEX "resource_permission_users_resource_kind_resource_slug_user_id_key" ON "resource_permission_users"("resource_kind", "resource_slug", "user_id");

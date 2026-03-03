-- CreateTable
CREATE TABLE "skill_access_permission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skill_slug" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "skill_access_permission_users_skill_slug_fkey" FOREIGN KEY ("skill_slug") REFERENCES "skill_metadata" ("skill_slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_access_permission_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_metadata" (
    "skill_slug" TEXT NOT NULL PRIMARY KEY,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "access_permission_mode" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "skill_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_approved_snapshots" (
    "skill_slug" TEXT NOT NULL PRIMARY KEY,
    "file_count" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "skill_approved_snapshots_skill_slug_fkey" FOREIGN KEY ("skill_slug") REFERENCES "skill_metadata" ("skill_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_approved_snapshot_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skill_slug" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "content_kind" TEXT NOT NULL,
    "text_content" TEXT,
    "binary_content" BLOB,
    "size_bytes" INTEGER NOT NULL,
    "content_sha256" TEXT NOT NULL,
    CONSTRAINT "skill_approved_snapshot_files_skill_slug_fkey" FOREIGN KEY ("skill_slug") REFERENCES "skill_approved_snapshots" ("skill_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "skill_access_permission_users_skill_slug_idx" ON "skill_access_permission_users"("skill_slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_access_permission_users_skill_slug_user_id_key" ON "skill_access_permission_users"("skill_slug", "user_id");

-- CreateIndex
CREATE INDEX "skill_metadata_created_by_user_id_idx" ON "skill_metadata"("created_by_user_id");

-- CreateIndex
CREATE INDEX "skill_metadata_approved_by_user_id_idx" ON "skill_metadata"("approved_by_user_id");

-- CreateIndex
CREATE INDEX "skill_approved_snapshot_files_skill_slug_idx" ON "skill_approved_snapshot_files"("skill_slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_approved_snapshot_files_skill_slug_relative_path_key" ON "skill_approved_snapshot_files"("skill_slug", "relative_path");

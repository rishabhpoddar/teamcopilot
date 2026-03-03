-- CreateTable
CREATE TABLE "resource_metadata" (
    "resource_kind" TEXT NOT NULL,
    "resource_slug" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    PRIMARY KEY ("resource_kind", "resource_slug"),
    CONSTRAINT "resource_metadata_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "resource_metadata_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_approved_snapshots" (
    "resource_kind" TEXT NOT NULL,
    "resource_slug" TEXT NOT NULL,
    "file_count" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    PRIMARY KEY ("resource_kind", "resource_slug"),
    CONSTRAINT "resource_approved_snapshots_resource_kind_resource_slug_fkey" FOREIGN KEY ("resource_kind", "resource_slug") REFERENCES "resource_metadata" ("resource_kind", "resource_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_approved_snapshot_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_kind" TEXT NOT NULL,
    "resource_slug" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "content_kind" TEXT NOT NULL,
    "text_content" TEXT,
    "binary_content" BLOB,
    "size_bytes" INTEGER NOT NULL,
    "content_sha256" TEXT NOT NULL,
    CONSTRAINT "resource_approved_snapshot_files_resource_kind_resource_slug_fkey" FOREIGN KEY ("resource_kind", "resource_slug") REFERENCES "resource_approved_snapshots" ("resource_kind", "resource_slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "resource_metadata_resource_slug_idx" ON "resource_metadata"("resource_slug");

-- CreateIndex
CREATE INDEX "resource_metadata_created_by_user_id_idx" ON "resource_metadata"("created_by_user_id");

-- CreateIndex
CREATE INDEX "resource_metadata_approved_by_user_id_idx" ON "resource_metadata"("approved_by_user_id");

-- CreateIndex
CREATE INDEX "resource_approved_snapshots_resource_slug_idx" ON "resource_approved_snapshots"("resource_slug");

-- CreateIndex
CREATE INDEX "resource_approved_snapshot_files_resource_kind_resource_slug_idx" ON "resource_approved_snapshot_files"("resource_kind", "resource_slug");

-- CreateIndex
CREATE UNIQUE INDEX "resource_approved_snapshot_files_resource_kind_resource_slug_relative_path_key" ON "resource_approved_snapshot_files"("resource_kind", "resource_slug", "relative_path");

-- Migrate workflow metadata/snapshots into shared resource tables
INSERT OR IGNORE INTO "resource_metadata" (
    "resource_kind",
    "resource_slug",
    "created_by_user_id",
    "approved_by_user_id",
    "created_at",
    "updated_at"
)
SELECT
    'workflow',
    "workflow_slug",
    "created_by_user_id",
    "approved_by_user_id",
    "created_at",
    "updated_at"
FROM "workflow_metadata";

INSERT OR IGNORE INTO "resource_approved_snapshots" (
    "resource_kind",
    "resource_slug",
    "file_count",
    "created_at",
    "updated_at"
)
SELECT
    'workflow',
    "workflow_slug",
    "file_count",
    "created_at",
    "updated_at"
FROM "workflow_approved_snapshots";

INSERT OR IGNORE INTO "resource_approved_snapshot_files" (
    "id",
    "resource_kind",
    "resource_slug",
    "relative_path",
    "content_kind",
    "text_content",
    "binary_content",
    "size_bytes",
    "content_sha256"
)
SELECT
    "id",
    'workflow',
    "workflow_slug",
    "relative_path",
    "content_kind",
    "text_content",
    "binary_content",
    "size_bytes",
    "content_sha256"
FROM "workflow_approved_snapshot_files";

-- Migrate skill metadata/snapshots into shared resource tables
INSERT OR IGNORE INTO "resource_metadata" (
    "resource_kind",
    "resource_slug",
    "created_by_user_id",
    "approved_by_user_id",
    "created_at",
    "updated_at"
)
SELECT
    'skill',
    "skill_slug",
    "created_by_user_id",
    "approved_by_user_id",
    "created_at",
    "updated_at"
FROM "skill_metadata";

INSERT OR IGNORE INTO "resource_approved_snapshots" (
    "resource_kind",
    "resource_slug",
    "file_count",
    "created_at",
    "updated_at"
)
SELECT
    'skill',
    "skill_slug",
    "file_count",
    "created_at",
    "updated_at"
FROM "skill_approved_snapshots";

INSERT OR IGNORE INTO "resource_approved_snapshot_files" (
    "id",
    "resource_kind",
    "resource_slug",
    "relative_path",
    "content_kind",
    "text_content",
    "binary_content",
    "size_bytes",
    "content_sha256"
)
SELECT
    "id",
    'skill',
    "skill_slug",
    "relative_path",
    "content_kind",
    "text_content",
    "binary_content",
    "size_bytes",
    "content_sha256"
FROM "skill_approved_snapshot_files";

-- Drop legacy duplicated tables
PRAGMA foreign_keys=off;
DROP TABLE "skill_approved_snapshot_files";
DROP TABLE "skill_approved_snapshots";
DROP TABLE "skill_metadata";
DROP TABLE "workflow_approved_snapshot_files";
DROP TABLE "workflow_approved_snapshots";
DROP TABLE "workflow_metadata";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workflow_approved_snapshots" (
    "workflow_slug" TEXT NOT NULL PRIMARY KEY,
    "file_count" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "workflow_approved_snapshots_workflow_slug_fkey" FOREIGN KEY ("workflow_slug") REFERENCES "workflow_metadata" ("workflow_slug") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workflow_approved_snapshots" ("created_at", "file_count", "updated_at", "workflow_slug") SELECT "created_at", "file_count", "updated_at", "workflow_slug" FROM "workflow_approved_snapshots";
DROP TABLE "workflow_approved_snapshots";
ALTER TABLE "new_workflow_approved_snapshots" RENAME TO "workflow_approved_snapshots";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


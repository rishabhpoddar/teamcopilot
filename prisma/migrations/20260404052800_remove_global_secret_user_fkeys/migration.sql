-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_global_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);
INSERT INTO "new_global_secrets" ("created_at", "created_by_user_id", "id", "key", "updated_at", "updated_by_user_id", "value") SELECT "created_at", "created_by_user_id", "id", "key", "updated_at", "updated_by_user_id", "value" FROM "global_secrets";
DROP TABLE "global_secrets";
ALTER TABLE "new_global_secrets" RENAME TO "global_secrets";
CREATE UNIQUE INDEX "global_secrets_key_key" ON "global_secrets"("key");
CREATE INDEX "global_secrets_created_by_user_id_idx" ON "global_secrets"("created_by_user_id");
CREATE INDEX "global_secrets_updated_by_user_id_idx" ON "global_secrets"("updated_by_user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

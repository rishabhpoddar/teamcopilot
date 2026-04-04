-- CreateTable
CREATE TABLE "user_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "user_secrets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "global_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "global_secrets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "global_secrets_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "user_secrets_user_id_idx" ON "user_secrets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_secrets_user_id_key_key" ON "user_secrets"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "global_secrets_key_key" ON "global_secrets"("key");

-- CreateIndex
CREATE INDEX "global_secrets_created_by_user_id_idx" ON "global_secrets"("created_by_user_id");

-- CreateIndex
CREATE INDEX "global_secrets_updated_by_user_id_idx" ON "global_secrets"("updated_by_user_id");

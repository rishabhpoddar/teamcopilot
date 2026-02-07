/*
  Warnings:

  - Added the required column `role` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "reset_token" TEXT,
    "reset_token_expires_at" BIGINT
);
INSERT INTO "new_users" ("created_at", "email", "id", "name", "role", "password_hash", "reset_token", "reset_token_expires_at") SELECT "created_at", "email", "id", "name", 'Engineer', "password_hash", "reset_token", "reset_token_expires_at" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

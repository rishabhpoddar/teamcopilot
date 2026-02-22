/*
  Warnings:

  - You are about to drop the `workflow_execution_permissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflow_execution_permissions";
PRAGMA foreign_keys=on;

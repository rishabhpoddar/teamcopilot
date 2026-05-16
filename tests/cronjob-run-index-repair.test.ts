import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-index-repair-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");

    try {
        await ensureWorkspaceDatabase();

        const initialIndexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
            `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'cronjob_runs_one_running_per_cronjob'`
        );
        assert.equal(initialIndexes.length, 1);
        assert.match(initialIndexes[0].sql ?? "", /WHERE "status" = 'running'/);

        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "cronjob_runs_one_running_per_cronjob"`);

        const droppedIndexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
            `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'cronjob_runs_one_running_per_cronjob'`
        );
        assert.equal(droppedIndexes.length, 0);

        await prisma.$disconnect();
        await ensureWorkspaceDatabase();

        const repairedIndexes = await prisma.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>(
            `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'cronjob_runs_one_running_per_cronjob'`
        );
        assert.equal(repairedIndexes.length, 1);
        assert.match(repairedIndexes[0].sql ?? "", /WHERE "status" = 'running'/);

        console.log("Cronjob run uniqueness index repair tests passed");
    } finally {
        await prisma.$disconnect();
    }
}

main();

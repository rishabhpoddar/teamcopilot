import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-delete-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `cronjob-delete-${Date.now()}@example.com`,
                name: "Cronjob Delete Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });

        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `cronjob-delete-auth-${Date.now()}`,
                title: "Cronjob delete auth session",
                created_at: now,
                updated_at: now,
            },
        });

        const cronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: `Delete Guard ${Date.now()}`,
                enabled: true,
                target_type: "prompt",
                prompt: "Do scheduled work",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
            },
        });

        const app = createApp();
        const response = await request(app)
            .delete(`/api/cronjobs/${cronjob.id}`)
            .set("Authorization", `Bearer ${authSession.opencode_session_id}`)
            .expect(409);

        assert.equal(
            response.body.message,
            "Cronjob currently has an active run. Terminate the active run before deleting it."
        );

        const stillExists = await prisma.cronjobs.findUnique({
            where: { id: cronjob.id },
            select: { id: true },
        });
        assert.notEqual(stillExists, null, "Running cronjob should not be deleted");

        console.log("Cronjob delete route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

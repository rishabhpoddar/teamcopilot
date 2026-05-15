import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-complete-"));
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
                email: `cronjob-complete-${Date.now()}@example.com`,
                name: "Cronjob Completion Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const cronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Completion route cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Complete me",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        const completeSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `cronjob-complete-session-${Date.now()}`,
                title: "Cronjob completion session",
                created_at: now,
                updated_at: now,
            },
        });
        const completeRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
                opencode_session_id: completeSession.opencode_session_id,
                session_id: completeSession.id,
            },
        });
        await prisma.cronjob_run_todos.create({
            data: {
                run_id: completeRun.id,
                content: "Complete the requested cronjob task",
                status: "completed",
                position: 0,
                summary: "Task completed",
                created_at: now,
                completed_at: now,
            },
        });

        const app = createApp();
        await request(app)
            .post("/api/cronjobs/runs/complete-current")
            .set("Authorization", `Bearer ${completeSession.opencode_session_id}`)
            .send({ summary: "Completed cleanly" })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const completedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: completeRun.id } });
        assert.equal(completedRun.status, "success");
        assert.equal(completedRun.summary, "Completed cleanly");
        assert.equal(completedRun.error_message, null);
        assert.notEqual(completedRun.completed_at, null);

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${completeSession.opencode_session_id}`)
            .send({ items: ["Should not mutate completed runs"], index: 0 })
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "Cronjob session is already finished. Current state is: success");
            });

        await request(app)
            .post("/api/cronjobs/runs/complete-current")
            .set("Authorization", `Bearer ${completeSession.opencode_session_id}`)
            .send({ summary: "Should not complete twice" })
            .expect(404)
            .expect((response) => {
                assert.equal(response.body.message, "Cronjob is not active. Current state is: success");
            });

        const failSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `cronjob-fail-session-${Date.now()}`,
                title: "Cronjob failure session",
                created_at: now,
                updated_at: now,
            },
        });
        const failRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now + 1n,
                opencode_session_id: failSession.opencode_session_id,
                session_id: failSession.id,
            },
        });

        await request(app)
            .post("/api/cronjobs/runs/fail-current")
            .set("Authorization", `Bearer ${failSession.opencode_session_id}`)
            .send({ summary: "Model failed before completing" })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const failedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: failRun.id } });
        assert.equal(failedRun.status, "failed");
        assert.equal(failedRun.summary, "Model failed before completing");
        assert.equal(failedRun.error_message, "Model failed before completing");
        assert.notEqual(failedRun.completed_at, null);

        const normalChatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `not-a-cronjob-session-${Date.now()}`,
                title: "Normal chat session",
                created_at: now,
                updated_at: now,
            },
        });

        await request(app)
            .post("/api/cronjobs/runs/complete-current")
            .set("Authorization", `Bearer ${normalChatSession.opencode_session_id}`)
            .send({ summary: "No cronjob run" })
            .expect(404)
            .expect((response) => {
                assert.equal(
                    response.body.message,
                    "This is not a cronjob session. If this was called via the markCronjobCompleted tool, then do not use this tool again.",
                );
            });

        console.log("Cronjob completion route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

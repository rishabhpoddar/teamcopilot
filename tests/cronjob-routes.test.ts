import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-routes-"));
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
                email: `cronjob-routes-${Date.now()}@example.com`,
                name: "Cronjob Route Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const otherUser = await prisma.users.create({
            data: {
                email: `cronjob-routes-other-${Date.now()}@example.com`,
                name: "Other Cronjob User",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `cronjob-routes-auth-${Date.now()}`,
                title: "Cronjob routes auth session",
                created_at: now,
                updated_at: now,
            },
        });

        const app = createApp();
        const auth = { Authorization: `Bearer ${authSession.opencode_session_id}` };

        const createResponse = await request(app)
            .post("/api/cronjobs")
            .set(auth)
            .send({
                name: "  Morning repo check  ",
                enabled: false,
                target_type: "prompt",
                prompt: "  Check repo health and summarize.  ",
                allow_workflow_runs_without_permission: false,
                cron_expression: " 0 9 * * 1-5 ",
                timezone: " UTC ",
            })
            .expect(200);

        const cronjobId = String(createResponse.body.cronjob.id);
        assert.equal(createResponse.body.cronjob.name, "Morning repo check");
        assert.equal(createResponse.body.cronjob.enabled, false);
        assert.equal(createResponse.body.cronjob.prompt, "Check repo health and summarize.");
        assert.equal(createResponse.body.cronjob.allow_workflow_runs_without_permission, false);
        assert.equal(createResponse.body.cronjob.target.target_type, "prompt");
        assert.equal(createResponse.body.cronjob.target.workflow_slug, null);
        assert.equal(createResponse.body.cronjob.schedule.cron_expression, "0 9 * * 1-5");
        assert.equal(createResponse.body.cronjob.schedule.timezone, "UTC");
        assert.equal(createResponse.body.cronjob.next_run_at, null);
        assert.equal(createResponse.body.cronjob.is_running, false);

        const storedCronjob = await prisma.cronjobs.findUniqueOrThrow({ where: { id: cronjobId } });
        assert.equal(storedCronjob.name, "Morning repo check");
        assert.equal(storedCronjob.prompt, "Check repo health and summarize.");
        assert.equal(storedCronjob.prompt_allow_workflow_runs_without_permission, false);

        await request(app)
            .post("/api/cronjobs")
            .set(auth)
            .send({
                name: "Morning repo check",
                enabled: false,
                target_type: "prompt",
                prompt: "Duplicate",
                cron_expression: "0 10 * * *",
                timezone: "UTC",
            })
            .expect(409)
            .expect((response) => {
                assert.equal(response.body.message, "A cronjob with this name already exists.");
            });

        await request(app)
            .post("/api/cronjobs")
            .set(auth)
            .send({
                name: "Bad timezone",
                enabled: false,
                target_type: "prompt",
                prompt: "Nope",
                cron_expression: "0 9 * * *",
                timezone: "Mars/Olympus",
            })
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "timezone must be a valid IANA timezone");
            });

        await request(app)
            .post("/api/cronjobs")
            .set(auth)
            .send({
                name: "Bad enabled",
                enabled: "false",
                target_type: "prompt",
                prompt: "Nope",
                cron_expression: "0 9 * * *",
                timezone: "UTC",
            })
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "enabled must be a boolean");
            });

        const patchResponse = await request(app)
            .patch(`/api/cronjobs/${cronjobId}`)
            .set(auth)
            .send({
                name: "Morning repo health",
                prompt: "Run a lighter repo health check.",
                cron_expression: "30 8 * * 1-5",
            })
            .expect(200);
        assert.equal(patchResponse.body.cronjob.name, "Morning repo health");
        assert.equal(patchResponse.body.cronjob.prompt, "Run a lighter repo health check.");
        assert.equal(patchResponse.body.cronjob.target.target_type, "prompt");
        assert.equal(patchResponse.body.cronjob.allow_workflow_runs_without_permission, false);
        assert.equal(patchResponse.body.cronjob.schedule.cron_expression, "30 8 * * 1-5");
        assert.equal(patchResponse.body.cronjob.schedule.timezone, "UTC");

        const enableResponse = await request(app)
            .post(`/api/cronjobs/${cronjobId}/enable`)
            .set(auth)
            .expect(200);
        assert.equal(enableResponse.body.cronjob.enabled, true);
        assert.equal(typeof enableResponse.body.cronjob.next_run_at, "number");

        const disableResponse = await request(app)
            .post(`/api/cronjobs/${cronjobId}/disable`)
            .set(auth)
            .expect(200);
        assert.equal(disableResponse.body.cronjob.enabled, false);
        assert.equal(disableResponse.body.cronjob.next_run_at, null);

        const missingId = "00000000-0000-4000-8000-000000000000";
        await request(app).get(`/api/cronjobs/${missingId}`).set(auth).expect(404);
        await request(app).patch(`/api/cronjobs/${missingId}`).set(auth).send({ name: "Missing" }).expect(404);
        await request(app).post(`/api/cronjobs/${missingId}/enable`).set(auth).expect(404);
        await request(app).post(`/api/cronjobs/${missingId}/disable`).set(auth).expect(404);
        await request(app).post(`/api/cronjobs/${missingId}/run-now`).set(auth).expect(404);
        await request(app).get(`/api/cronjobs/${missingId}/runs`).set(auth).expect(404);
        await request(app).post(`/api/cronjobs/runs/${missingId}/terminate`).set(auth).expect(404);

        const runningRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjobId,
                status: "running",
                started_at: now + 1n,
            },
        });

        const listResponse = await request(app)
            .get("/api/cronjobs")
            .set(auth)
            .expect(200);
        const listedCronjob = listResponse.body.cronjobs.find((cronjob: { id: string }) => cronjob.id === cronjobId);
        assert.ok(listedCronjob, "Expected created cronjob in list response");
        assert.equal(listedCronjob.is_running, true);
        assert.equal(listedCronjob.current_run_id, runningRun.id);
        assert.equal(listedCronjob.latest_run.id, runningRun.id);
        assert.equal(listedCronjob.latest_run.target_type_snapshot, "prompt");

        await request(app)
            .post(`/api/cronjobs/${cronjobId}/run-now`)
            .set(auth)
            .expect(409)
            .expect((response) => {
                assert.equal(
                    response.body.message,
                    "Cronjob already has an active run. Wait for it to finish, resume it, or terminate it first.",
                );
            });

        await request(app)
            .post(`/api/cronjobs/runs/${runningRun.id}/terminate`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const terminatedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: runningRun.id } });
        assert.equal(terminatedRun.status, "terminated");
        assert.equal(terminatedRun.error_message, "Cronjob run was terminated by the user.");
        assert.notEqual(terminatedRun.completed_at, null);

        await request(app)
            .post(`/api/cronjobs/runs/${runningRun.id}/terminate`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const otherCronjob = await prisma.cronjobs.create({
            data: {
                user_id: otherUser.id,
                name: "Other user's cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Should not be accessible",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        await request(app)
            .get(`/api/cronjobs/${otherCronjob.id}`)
            .set(auth)
            .expect(404);

        const otherRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: otherCronjob.id,
                status: "running",
                started_at: now + 2n,
            },
        });
        await request(app)
            .post(`/api/cronjobs/runs/${otherRun.id}/terminate`)
            .set(auth)
            .expect(404);

        await request(app)
            .get(`/api/cronjobs/${cronjobId}/runs`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.runs[0].id, runningRun.id);
                assert.equal(response.body.runs[0].target_type_snapshot, "prompt");
                assert.equal(response.body.runs[0].prompt_snapshot, "Run a lighter repo health check.");
            });

        await request(app)
            .delete(`/api/cronjobs/${cronjobId}`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const deletedCronjob = await prisma.cronjobs.findUnique({ where: { id: cronjobId } });
        const deletedRuns = await prisma.cronjob_runs.findMany({ where: { cronjob_id: cronjobId } });
        assert.equal(deletedCronjob, null);
        assert.equal(deletedRuns.length, 0, "Deleting a completed cronjob should cascade-delete its run history");

        console.log("Cronjob route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

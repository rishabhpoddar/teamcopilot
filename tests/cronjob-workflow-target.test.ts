import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-workflow-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    const workflowSlug = "cronjob-workflow-demo";
    const workflowDir = path.join(workspaceDir, "workflows", workflowSlug);
    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
        path.join(workflowDir, "workflow.json"),
        JSON.stringify({
            intent_summary: "Cronjob workflow demo",
            inputs: {
                topic: {
                    type: "string",
                    required: true,
                    description: "Topic to summarize",
                },
                dry_run: {
                    type: "boolean",
                    default: false,
                    description: "Whether to dry run",
                },
            },
            required_secrets: [],
            triggers: { manual: true },
            runtime: { timeout_seconds: 30 },
        }, null, 2),
        "utf-8",
    );
    fs.writeFileSync(path.join(workflowDir, "run.py"), "print('ok')\n", "utf-8");

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { setWorkflowCreator } = require("../src/utils/workflow") as typeof import("../src/utils/workflow");
    const { approveWorkflowWithSnapshot } = require("../src/utils/workflow-approval-snapshot") as typeof import("../src/utils/workflow-approval-snapshot");
    const { initializeWorkflowRunPermissionsForCreator } = require("../src/utils/workflow-permissions") as typeof import("../src/utils/workflow-permissions");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const engineer = await prisma.users.create({
            data: {
                email: `cronjob-workflow-engineer-${Date.now()}@example.com`,
                name: "Cronjob Workflow Engineer",
                role: "Engineer",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const otherUser = await prisma.users.create({
            data: {
                email: `cronjob-workflow-other-${Date.now()}@example.com`,
                name: "Cronjob Workflow Other",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const engineerSession = await prisma.chat_sessions.create({
            data: {
                user_id: engineer.id,
                opencode_session_id: `cronjob-workflow-engineer-auth-${Date.now()}`,
                title: "Cronjob workflow engineer auth",
                created_at: now,
                updated_at: now,
            },
        });
        const otherSession = await prisma.chat_sessions.create({
            data: {
                user_id: otherUser.id,
                opencode_session_id: `cronjob-workflow-other-auth-${Date.now()}`,
                title: "Cronjob workflow other auth",
                created_at: now,
                updated_at: now,
            },
        });

        await setWorkflowCreator(workflowSlug, engineer.id);
        await initializeWorkflowRunPermissionsForCreator(workflowSlug, engineer.id);
        await approveWorkflowWithSnapshot(workflowSlug, engineer.id);

        const app = createApp();
        const engineerAuth = { Authorization: `Bearer ${engineerSession.opencode_session_id}` };
        const otherAuth = { Authorization: `Bearer ${otherSession.opencode_session_id}` };

        const createResponse = await request(app)
            .post("/api/cronjobs")
            .set(engineerAuth)
            .send({
                name: "Workflow cronjob",
                enabled: false,
                target_type: "workflow",
                workflow_slug: workflowSlug,
                workflow_inputs: {
                    topic: "weekly update",
                    dry_run: true,
                },
                cron_expression: "0 16 * * 2",
                timezone: "UTC",
            })
            .expect(200);

        const cronjobId = String(createResponse.body.cronjob.id);
        assert.equal(createResponse.body.cronjob.prompt, "");
        assert.equal(createResponse.body.cronjob.allow_workflow_runs_without_permission, true);
        assert.equal(createResponse.body.cronjob.target.target_type, "workflow");
        assert.equal(createResponse.body.cronjob.target.workflow_slug, workflowSlug);
        assert.deepEqual(createResponse.body.cronjob.target.workflow_inputs, {
            topic: "weekly update",
            dry_run: true,
        });

        const storedCronjob = await prisma.cronjobs.findUniqueOrThrow({ where: { id: cronjobId } });
        assert.equal(storedCronjob.target_type, "workflow");
        assert.equal(storedCronjob.prompt, null);
        assert.equal(storedCronjob.prompt_allow_workflow_runs_without_permission, null);
        assert.equal(storedCronjob.workflow_slug, workflowSlug);
        assert.deepEqual(JSON.parse(storedCronjob.workflow_input_json ?? ""), {
            topic: "weekly update",
            dry_run: true,
        });

        await request(app)
            .post("/api/cronjobs")
            .set(otherAuth)
            .send({
                name: "Unauthorized workflow cronjob",
                enabled: false,
                target_type: "workflow",
                workflow_slug: workflowSlug,
                workflow_inputs: {
                    topic: "weekly update",
                },
                cron_expression: "0 16 * * 2",
                timezone: "UTC",
            })
            .expect(403)
            .expect((response) => {
                assert.equal(response.body.message, "You do not have permission to run this workflow. Please contact the workflow owner to request permission.");
            });

        const workflowRun = await prisma.workflow_runs.create({
            data: {
                workflow_slug: workflowSlug,
                ran_by_user_id: engineer.id,
                status: "success",
                started_at: now + 1n,
                completed_at: now + 2n,
                args: JSON.stringify({ topic: "from actual run", dry_run: false }),
                output: "ok",
                run_source: "cronjob",
            },
        });
        const cronjobRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjobId,
                status: "success",
                started_at: now + 1n,
                completed_at: now + 2n,
                workflow_run_id: workflowRun.id,
                summary: "Workflow completed successfully.",
            },
        });

        await request(app)
            .get(`/api/cronjobs/${cronjobId}/runs`)
            .set(engineerAuth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.runs[0].id, cronjobRun.id);
                assert.equal(response.body.runs[0].target_type_snapshot, "workflow");
                assert.equal(response.body.runs[0].prompt_snapshot, null);
                assert.equal(response.body.runs[0].workflow_slug_snapshot, workflowSlug);
                assert.deepEqual(response.body.runs[0].workflow_input_snapshot, {
                    topic: "from actual run",
                    dry_run: false,
                });
                assert.equal(response.body.runs[0].workflow_run_id, workflowRun.id);
            });

        await prisma.workflow_runs.delete({ where: { id: workflowRun.id } });
        const cascadedCronjobRun = await prisma.cronjob_runs.findUnique({ where: { id: cronjobRun.id } });
        assert.equal(cascadedCronjobRun, null, "Deleting a linked workflow run should cascade-delete the cronjob run");

        const patchResponse = await request(app)
            .patch(`/api/cronjobs/${cronjobId}`)
            .set(engineerAuth)
            .send({
                target_type: "prompt",
                prompt: "Switch this back to a prompt cronjob.",
                allow_workflow_runs_without_permission: false,
            })
            .expect(200);
        assert.equal(patchResponse.body.cronjob.target.target_type, "prompt");
        assert.equal(patchResponse.body.cronjob.target.workflow_slug, null);
        assert.equal(patchResponse.body.cronjob.target.workflow_inputs, null);
        assert.equal(patchResponse.body.cronjob.prompt, "Switch this back to a prompt cronjob.");
        assert.equal(patchResponse.body.cronjob.allow_workflow_runs_without_permission, false);

        const workflowPatchResponse = await request(app)
            .patch(`/api/cronjobs/${cronjobId}`)
            .set(engineerAuth)
            .send({
                target_type: "workflow",
                workflow_slug: workflowSlug,
                workflow_inputs: {
                    topic: "patched workflow",
                    dry_run: true,
                },
            })
            .expect(200);
        assert.equal(workflowPatchResponse.body.cronjob.target.target_type, "workflow");
        assert.equal(workflowPatchResponse.body.cronjob.prompt, "");
        assert.equal(workflowPatchResponse.body.cronjob.target.prompt, null);
        assert.equal(workflowPatchResponse.body.cronjob.target.prompt_allow_workflow_runs_without_permission, null);
        assert.equal(workflowPatchResponse.body.cronjob.target.workflow_slug, workflowSlug);
        assert.deepEqual(workflowPatchResponse.body.cronjob.target.workflow_inputs, {
            topic: "patched workflow",
            dry_run: true,
        });
        const patchedWorkflowCronjob = await prisma.cronjobs.findUniqueOrThrow({ where: { id: cronjobId } });
        assert.equal(patchedWorkflowCronjob.prompt, null);
        assert.equal(patchedWorkflowCronjob.prompt_allow_workflow_runs_without_permission, null);
        assert.deepEqual(JSON.parse(patchedWorkflowCronjob.workflow_input_json ?? ""), {
            topic: "patched workflow",
            dry_run: true,
        });

        console.log("Cronjob workflow target tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

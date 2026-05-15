import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-reconcile-running-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { reconcileRunningCronsAndWorkflowRunsOnStartup } = require("../src/utils") as typeof import("../src/utils");

    try {
        await ensureWorkspaceDatabase();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `reconcile-running-${Date.now()}@example.com`,
                name: "Reconcile Running Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const promptCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Recoverable prompt cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Should stay running",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        const workflowCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Interrupted workflow cronjob",
                enabled: false,
                target_type: "workflow",
                prompt: null,
                prompt_allow_workflow_runs_without_permission: false,
                workflow_slug: "reconcile-workflow",
                workflow_input_json: "{}",
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        const runningPromptCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "running",
                started_at: now,
            },
        });
        const runningWorkflowCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: workflowCronjob.id,
                status: "running",
                started_at: now,
            },
        });
        const completedCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "success",
                started_at: now - 1n,
                completed_at: now,
                summary: "Already complete",
            },
        });
        const runningWorkflowRun = await prisma.workflow_runs.create({
            data: {
                workflow_slug: "reconcile-workflow",
                ran_by_user_id: user.id,
                status: "running",
                started_at: now,
                args: "{}",
                run_source: "user",
            },
        });
        const completedWorkflowRun = await prisma.workflow_runs.create({
            data: {
                workflow_slug: "reconcile-workflow",
                ran_by_user_id: user.id,
                status: "success",
                started_at: now - 1n,
                completed_at: now,
                args: "{}",
                output: "ok",
                run_source: "user",
            },
        });

        await reconcileRunningCronsAndWorkflowRunsOnStartup();

        const untouchedPromptCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: runningPromptCronRun.id } });
        assert.equal(untouchedPromptCronRun.status, "running");
        assert.equal(untouchedPromptCronRun.error_message, null);
        assert.equal(untouchedPromptCronRun.completed_at, null);

        const reconciledWorkflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: runningWorkflowCronRun.id } });
        assert.equal(reconciledWorkflowCronRun.status, "failed");
        assert.equal(reconciledWorkflowCronRun.error_message, "Workflow cronjob run was interrupted because TeamCopilot restarted.");
        assert.notEqual(reconciledWorkflowCronRun.completed_at, null);

        const untouchedCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: completedCronRun.id } });
        assert.equal(untouchedCronRun.status, "success");
        assert.equal(untouchedCronRun.summary, "Already complete");

        const reconciledWorkflowRun = await prisma.workflow_runs.findUniqueOrThrow({ where: { id: runningWorkflowRun.id } });
        assert.equal(reconciledWorkflowRun.status, "failed");
        assert.equal(reconciledWorkflowRun.error_message, "Workflow run was interrupted because TeamCopilot restarted.");
        assert.notEqual(reconciledWorkflowRun.completed_at, null);

        const untouchedWorkflowRun = await prisma.workflow_runs.findUniqueOrThrow({ where: { id: completedWorkflowRun.id } });
        assert.equal(untouchedWorkflowRun.status, "success");
        assert.equal(untouchedWorkflowRun.output, "ok");

        console.log("Reconcile running crons and workflow runs tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

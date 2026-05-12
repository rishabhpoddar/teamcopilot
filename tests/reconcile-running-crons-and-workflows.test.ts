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
        const cronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Running reconcile cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Should be reconciled",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        const runningCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
            },
        });
        const completedCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
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

        const reconciledCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: runningCronRun.id } });
        assert.equal(reconciledCronRun.status, "failed");
        assert.equal(reconciledCronRun.error_message, "Cronjob run was interrupted because TeamCopilot restarted.");
        assert.notEqual(reconciledCronRun.completed_at, null);

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

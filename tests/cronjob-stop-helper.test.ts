import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-stop-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { terminateCronjobRun } = require("../src/cronjobs/scheduler") as typeof import("../src/cronjobs/scheduler");

    try {
        await ensureWorkspaceDatabase();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `cronjob-stop-${Date.now()}@example.com`,
                name: "Cronjob Stop Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const cronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Terminate helper prompt cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Stop me",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        const promptRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
            },
        });
        await terminateCronjobRun(promptRun.id);
        const terminatedPromptRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: promptRun.id } });
        assert.equal(terminatedPromptRun.status, "terminated");
        assert.equal(terminatedPromptRun.error_message, "Cronjob run was terminated by the user.");

        const workflowCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Terminate helper workflow cronjob",
                enabled: false,
                target_type: "workflow",
                prompt: null,
                prompt_allow_workflow_runs_without_permission: false,
                workflow_slug: "stop-helper-workflow",
                workflow_input_json: "{}",
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        const workflowRun = await prisma.workflow_runs.create({
            data: {
                workflow_slug: "stop-helper-workflow",
                ran_by_user_id: user.id,
                status: "running",
                started_at: now,
                session_id: "workflow-session-to-abort",
                args: "{}",
                run_source: "cronjob",
            },
        });
        const workflowCronRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: workflowCronjob.id,
                status: "running",
                started_at: now,
                workflow_run_id: workflowRun.id,
            },
        });
        await terminateCronjobRun(workflowCronRun.id);
        const terminatedWorkflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: workflowCronRun.id } });
        assert.equal(terminatedWorkflowCronRun.status, "failed");
        assert.equal(terminatedWorkflowCronRun.error_message, "Cronjob run was terminated by the user.");
        const abortedWorkflow = await prisma.workflow_aborted_sessions.findUnique({
            where: { session_id: "workflow-session-to-abort" },
        });
        assert.notEqual(abortedWorkflow, null);

        const terminalRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "success",
                started_at: now,
                completed_at: now,
                opencode_session_id: "ses-terminal",
            },
        });
        await terminateCronjobRun(terminalRun.id);
        const unchangedTerminalRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: terminalRun.id } });
        assert.equal(unchangedTerminalRun.status, "success");

        console.log("Cronjob terminate helper tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-stop-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const sessionAbortModule = require("../src/utils/session-abort") as typeof import("../src/utils/session-abort");
    const abortedOpencodeSessions: string[] = [];
    (sessionAbortModule as unknown as {
        abortOpencodeSession: (sessionId: string) => Promise<void>;
    }).abortOpencodeSession = async (sessionId: string) => {
        abortedOpencodeSessions.push(sessionId);
    };

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { stopCronjobRun } = require("../src/utils/cronjob-stop") as typeof import("../src/utils/cronjob-stop");

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
                name: "Stop helper cronjob",
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
                opencode_session_id: "ses-stop-prompt",
            },
        });
        await stopCronjobRun(promptRun);
        const stoppedPromptRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: promptRun.id } });
        assert.equal(stoppedPromptRun.status, "failed");
        assert.equal(stoppedPromptRun.error_message, "Cronjob run was stopped by the user.");
        assert.deepEqual(abortedOpencodeSessions, ["ses-stop-prompt"]);

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
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
                workflow_run_id: workflowRun.id,
            },
        });
        await stopCronjobRun(workflowCronRun);
        const stoppedWorkflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: workflowCronRun.id } });
        assert.equal(stoppedWorkflowCronRun.status, "failed");
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
        await stopCronjobRun(terminalRun);
        const unchangedTerminalRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: terminalRun.id } });
        assert.equal(unchangedTerminalRun.status, "success");
        assert.deepEqual(abortedOpencodeSessions, ["ses-stop-prompt"]);

        console.log("Cronjob stop helper tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

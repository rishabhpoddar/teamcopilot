import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-dispatch-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const promptCalls: unknown[] = [];
    let nextPromptShouldFail = false;
    let createdSessionCounter = 0;
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
        listPendingQuestions: () => Promise<unknown[]>;
        listPendingPermissions: () => Promise<unknown[]>;
    }).getOpencodeClient = async () => ({
        session: {
            create: async () => ({ data: { id: `ses-cron-dispatch-${++createdSessionCounter}` } }),
            promptAsync: async (input: unknown) => {
                promptCalls.push(input);
                return nextPromptShouldFail
                    ? { error: { message: "prompt failed" } }
                    : { data: { id: "prompt-ok" } };
            },
            status: async () => ({ data: {} }),
        },
    });
    (opencodeClientModule as unknown as { listPendingQuestions: () => Promise<unknown[]> }).listPendingQuestions = async () => [];
    (opencodeClientModule as unknown as { listPendingPermissions: () => Promise<unknown[]> }).listPendingPermissions = async () => [];

    const workflowRunnerModule = require("../src/utils/workflow-runner") as typeof import("../src/utils/workflow-runner");
    const workflowStartCalls: unknown[] = [];
    let nextWorkflowStartShouldFail = false;
    (workflowRunnerModule as unknown as {
        startWorkflowRunViaBackend: (args: unknown) => Promise<unknown>;
    }).startWorkflowRunViaBackend = async (args: unknown) => {
        workflowStartCalls.push(args);
        if (nextWorkflowStartShouldFail) {
            throw new Error("workflow start failed");
        }
        return {
            runId: "workflow-run-1",
            completion: Promise.resolve({ status: "success", output: "ok" }),
        };
    };

    const workflowValidationModule = require("../src/utils/workflow-run-validation") as typeof import("../src/utils/workflow-run-validation");
    (workflowValidationModule as unknown as {
        assertUserCanRunWorkflow: () => Promise<void>;
    }).assertUserCanRunWorkflow = async () => undefined;

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const scheduledIntervals: Array<{ delay: number }> = [];
    (globalThis as unknown as {
        setInterval: (handler: () => void, delay: number) => NodeJS.Timeout;
        clearInterval: (id: NodeJS.Timeout) => void;
    }).setInterval = ((_handler: () => void, delay: number) => {
        scheduledIntervals.push({ delay });
        return 0 as unknown as NodeJS.Timeout;
    }) as typeof setInterval;
    (globalThis as unknown as { clearInterval: (id: NodeJS.Timeout) => void }).clearInterval = (() => undefined) as typeof clearInterval;

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { dispatchCronjobRun } = require("../src/cronjobs/scheduler") as typeof import("../src/cronjobs/scheduler");

    try {
        await ensureWorkspaceDatabase();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `cronjob-dispatch-${Date.now()}@example.com`,
                name: "Cronjob Dispatch Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const disabledCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Disabled scheduled cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Should not run on schedule",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        await assert.rejects(
            () => dispatchCronjobRun(disabledCronjob.id, "scheduled"),
            /Cronjob is disabled/,
        );

        const activeCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Already active cronjob",
                enabled: true,
                target_type: "prompt",
                prompt: "Skip if active",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        await prisma.cronjob_runs.create({
            data: {
                cronjob_id: activeCronjob.id,
                status: "running",
                started_at: now,
            },
        });

        const skippedRunId = await dispatchCronjobRun(activeCronjob.id, "scheduled");
        const skippedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: skippedRunId } });
        assert.equal(skippedRun.status, "skipped");
        assert.equal(skippedRun.error_message, "Previous run is still active.");

        await assert.rejects(
            () => dispatchCronjobRun(activeCronjob.id, "manual"),
            (err: unknown) => {
                assert.equal((err as { status?: number }).status, 409);
                assert.equal((err as { message?: string }).message, "Cronjob already has an active run. Wait for it to finish, resume it, or terminate it first.");
                return true;
            },
        );

        const promptCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Prompt dispatch cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Perform prompt dispatch.",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "*/10 * * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        const promptRunId = await dispatchCronjobRun(promptCronjob.id, "manual");
        const promptRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: promptRunId } });
        assert.equal(promptRun.status, "running");
        assert.equal(promptRun.opencode_session_id, "ses-cron-dispatch-1");
        assert.notEqual(promptRun.session_id, null);
        const hiddenChat = await prisma.chat_sessions.findUniqueOrThrow({ where: { id: promptRun.session_id! } });
        assert.equal(hiddenChat.visible_to_user, false);
        assert.equal(hiddenChat.title, "Cronjob: Prompt dispatch cronjob");
        assert.equal(promptCalls.length, 1);
        const promptText = (promptCalls[0] as { body: { parts: Array<{ text: string }> } }).body.parts[0].text;
        assert.ok(promptText.includes("# Cronjob runtime instructions"));
        assert.ok(promptText.includes("# Current time"));
        assert.ok(promptText.includes("####### Actual user message below #######"));
        assert.ok(promptText.includes("Name: Prompt dispatch cronjob"));
        assert.ok(promptText.includes("Perform prompt dispatch."));
        assert.equal(scheduledIntervals.length, 1, "Prompt cronjob dispatch should start a monitor interval");

        const failingPromptCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Failing prompt dispatch cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "This will fail to send.",
                prompt_allow_workflow_runs_without_permission: true,
                cron_expression: "*/10 * * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        nextPromptShouldFail = true;
        await assert.rejects(
            () => dispatchCronjobRun(failingPromptCronjob.id, "manual"),
            /Failed to send cronjob prompt to opencode/,
        );
        const failedPromptRun = await prisma.cronjob_runs.findFirstOrThrow({
            where: { cronjob_id: failingPromptCronjob.id },
        });
        assert.equal(failedPromptRun.status, "failed");
        assert.equal(failedPromptRun.error_message, "Failed to start cronjob opencode prompt.");

        const workflowCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Workflow dispatch cronjob",
                enabled: false,
                target_type: "workflow",
                prompt: null,
                prompt_allow_workflow_runs_without_permission: null,
                workflow_slug: "workflow-dispatch-demo",
                workflow_input_json: JSON.stringify({ topic: "dispatch" }),
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        await prisma.workflow_runs.create({
            data: {
                id: "workflow-run-1",
                workflow_slug: "workflow-dispatch-demo",
                ran_by_user_id: user.id,
                status: "running",
                started_at: now,
                args: JSON.stringify({ topic: "dispatch" }),
                run_source: "cronjob",
            },
        });
        const workflowRunId = await dispatchCronjobRun(workflowCronjob.id, "manual");
        const workflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: workflowRunId } });
        assert.equal(workflowCronRun.workflow_run_id, "workflow-run-1");
        assert.equal(workflowStartCalls.length, 1);
        assert.deepEqual(
            (workflowStartCalls[0] as { inputs: unknown; requirePermissionPrompt: boolean; runSource: string }).inputs,
            { topic: "dispatch" },
        );
        assert.equal((workflowStartCalls[0] as { requirePermissionPrompt: boolean }).requirePermissionPrompt, false);
        assert.equal((workflowStartCalls[0] as { runSource: string }).runSource, "cronjob");
        await new Promise((resolve) => setImmediate(resolve));
        const completedWorkflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: workflowRunId } });
        assert.equal(completedWorkflowCronRun.status, "success");
        assert.equal(completedWorkflowCronRun.summary, "Workflow completed successfully.");

        const failingWorkflowCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Failing workflow dispatch cronjob",
                enabled: false,
                target_type: "workflow",
                workflow_slug: "workflow-dispatch-demo",
                workflow_input_json: "{}",
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        nextWorkflowStartShouldFail = true;
        const failedWorkflowRunId = await dispatchCronjobRun(failingWorkflowCronjob.id, "manual");
        const failedWorkflowCronRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: failedWorkflowRunId } });
        assert.equal(failedWorkflowCronRun.status, "failed");
        assert.equal(failedWorkflowCronRun.error_message, "workflow start failed");

        console.log("Cronjob dispatch tests passed");
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

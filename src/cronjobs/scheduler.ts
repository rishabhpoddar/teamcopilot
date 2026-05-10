import { CronJob, CronTime } from "cron";
import { randomUUID } from "crypto";
import prisma from "../prisma/client";
import {
    getOpencodeClient,
    listPendingPermissions,
    listPendingQuestions,
} from "../utils/opencode-client";
import { getWorkspaceDirFromEnv } from "../utils/workspace-sync";
import { startWorkflowRunViaBackend } from "../utils/workflow-runner";
import {
    getSessionStatusTypeForSession,
    type SessionStatusMap,
} from "../utils/chat-session";
import {
    ACTUAL_USER_MESSAGE_MARKER,
    buildAvailableSecretsPrompt,
    buildAvailableSkillsPrompt,
} from "../utils/chat-prompt-context";
import type { CronjobSchedule, CronjobTargetType } from "../types/cronjob";
import { assertUserCanRunWorkflow } from "../utils/workflow-run-validation";

const CRONJOB_MONITOR_INTERVAL_MS = 5000;

const scheduledJobs = new Map<string, CronJob>();
const runningMonitors = new Map<string, NodeJS.Timeout>();
type CronjobDispatchMode = "scheduled" | "manual";

function nowMs(): bigint {
    return BigInt(Date.now());
}

function assertTimezone(timezone: string): void {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
        throw {
            status: 400,
            message: "timezone must be a valid IANA timezone"
        };
    }
}

function toCronPackageExpression(cronExpression: string): string {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length === 5) {
        return `0 ${cronExpression.trim()}`;
    }
    if (parts.length === 6) {
        return cronExpression.trim();
    }
    throw {
        status: 400,
        message: "cron_expression must have 5 or 6 fields"
    };
}

function assertCronExpression(cronExpression: string, timezone: string): void {
    const expression = toCronPackageExpression(cronExpression);
    const validation = CronTime.validateCronExpression(expression);
    if (!validation.valid) {
        throw {
            status: 400,
            message: validation.error?.message || "Invalid cron expression"
        };
    }
    new CronTime(expression, timezone);
}

function assertNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw {
            status: 400,
            message: `${label} is required`
        };
    }
    return value.trim();
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw {
            status: 400,
            message: `${label} must be an object`
        };
    }
    return value as Record<string, unknown>;
}

function assertCronjobTargetType(value: unknown): CronjobTargetType {
    if (value !== "prompt" && value !== "workflow") {
        throw {
            status: 400,
            message: "target_type must be prompt or workflow"
        };
    }
    return value;
}

async function validatePromptCronjobTarget(input: {
    prompt?: unknown;
    allow_workflow_runs_without_permission?: unknown;
}): Promise<{
    prompt: string;
    promptAllowWorkflowRunsWithoutPermission: boolean;
}> {
    return {
        prompt: assertNonEmptyString(input.prompt, "prompt"),
        promptAllowWorkflowRunsWithoutPermission: input.allow_workflow_runs_without_permission !== false,
    };
}

export async function validateCronjobTarget(input: {
    target_type: unknown;
    prompt?: unknown;
    allow_workflow_runs_without_permission?: unknown;
    workflow_slug?: unknown;
    workflow_inputs?: unknown;
}, userId: string): Promise<{
    targetType: "prompt" | "workflow";
    prompt: string | null;
    promptAllowWorkflowRunsWithoutPermission: boolean | null;
    workflowSlug: string | null;
    workflowInputJson: string | null;
}> {
    const targetType = assertCronjobTargetType(input.target_type);
    if (targetType === "prompt") {
        const promptTarget = await validatePromptCronjobTarget(input);
        return {
            targetType,
            prompt: promptTarget.prompt,
            promptAllowWorkflowRunsWithoutPermission: promptTarget.promptAllowWorkflowRunsWithoutPermission,
            workflowSlug: null,
            workflowInputJson: null,
        };
    }

    const workflowSlug = assertNonEmptyString(input.workflow_slug, "workflow_slug");
    const workflowInputs = input.workflow_inputs === undefined ? {} : assertObject(input.workflow_inputs, "workflow_inputs");
    await assertUserCanRunWorkflow(workflowSlug, userId);
    return {
        targetType,
        prompt: null,
        promptAllowWorkflowRunsWithoutPermission: null,
        workflowSlug,
        workflowInputJson: JSON.stringify(workflowInputs),
    };
}

export function validateCronjobSchedule(input: {
    cron_expression?: unknown;
    timezone?: unknown;
}): {
    cronExpression: string;
    timezone: string;
} {
    if (typeof input.timezone !== "string" || input.timezone.trim().length === 0) {
        throw {
            status: 400,
            message: "timezone is required"
        };
    }
    const timezone = input.timezone.trim();
    assertTimezone(timezone);

    if (typeof input.cron_expression !== "string" || input.cron_expression.trim().length === 0) {
        throw {
            status: 400,
            message: "cron_expression is required"
        };
    }

    const cronExpression = input.cron_expression.trim();
    assertCronExpression(cronExpression, timezone);
    return {
        cronExpression,
        timezone,
    };
}

export function getNextRunAt(schedule: CronjobSchedule): number {
    const expression = toCronPackageExpression(schedule.cron_expression);
    const cronTime = new CronTime(expression, schedule.timezone);
    return cronTime.sendAt().toMillis();
}

function getCronjobTimeoutAt(schedule: CronjobSchedule, startedAtMs: number): number {
    const expression = toCronPackageExpression(schedule.cron_expression);
    const cronTime = new CronTime(expression, schedule.timezone);
    const firstRun = cronTime.getNextDateFrom(new Date(startedAtMs), schedule.timezone);
    const secondRun = cronTime.getNextDateFrom(firstRun.toJSDate(), schedule.timezone);
    return startedAtMs + Math.ceil((secondRun.toMillis() - firstRun.toMillis()) * 1.5);
}

async function buildCronjobPrompt(args: {
    cronjobName: string;
    cronjobPrompt: string;
    userId: string;
}): Promise<string> {
    const sections = [
        "# Cronjob runtime instructions",
        "",
        "This is an unattended scheduled TeamCopilot cronjob run.",
        "Treat the cronjob prompt below as the task to execute.",
        "Keep working until the requested cronjob task is complete or the tool loop is blocked by a real permission, tool question, or safety boundary.",
        "Do not ask the user questions in normal prose unless the task explicitly requires user approval or clarification that cannot be safely inferred.",
        "If the task cannot be finished because of a non-recoverable issue, call markCronjobFailed with a concise reason instead of leaving the run hanging.",
        "The only way to mark this cronjob finished successfully is to call the markCronjobCompleted tool.",
        "If the tool loop stops without markCronjobCompleted or markCronjobFailed being called, TeamCopilot will reveal this session to the user as needing attention.",
        "Call markCronjobCompleted only after the requested work is actually complete.",
        "The completion summary must be concise and suitable for cronjob run history.",
    ];
    const availableSkillsPrompt = await buildAvailableSkillsPrompt(args.userId);
    const availableSecretsPrompt = await buildAvailableSecretsPrompt(args.userId);
    if (availableSkillsPrompt) sections.push("", availableSkillsPrompt);
    if (availableSecretsPrompt) sections.push("", availableSecretsPrompt);
    sections.push("", ACTUAL_USER_MESSAGE_MARKER, "", "# Cronjob task", "", `Name: ${args.cronjobName}`, "", args.cronjobPrompt);
    return sections.join("\n");
}

function parseWorkflowInputJson(value: string | null): Record<string, unknown> {
    if (value === null || value.trim().length === 0) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Workflow input JSON must be an object");
    }
    return parsed as Record<string, unknown>;
}

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
}

async function markCronjobRunFailed(runId: string, errorMessage: string): Promise<void> {
    await prisma.cronjob_runs.updateMany({
        where: { id: runId, status: "running" },
        data: {
            status: "failed",
            completed_at: nowMs(),
            error_message: errorMessage,
        },
    });
}

async function createSkippedCronjobRun(cronjobId: string): Promise<string> {
    const now = nowMs();
    const skipped = await prisma.cronjob_runs.create({
        data: {
            cronjob_id: cronjobId,
            status: "skipped",
            started_at: now,
            completed_at: now,
            error_message: "Previous run is still active.",
        },
    });
    return skipped.id;
}

async function finishWorkflowCronjobRun(
    cronjobRunId: string,
    completion: Promise<{ status: string; output: string }>
): Promise<void> {
    try {
        const result = await completion;
        await prisma.cronjob_runs.updateMany({
            where: { id: cronjobRunId, status: "running" },
            data: {
                status: result.status === "success" ? "success" : "failed",
                completed_at: nowMs(),
                summary: result.status === "success" ? "Workflow completed successfully." : null,
                error_message: result.status === "success" ? null : result.output.slice(-1000),
            },
        });
    } catch (err) {
        await markCronjobRunFailed(cronjobRunId, getErrorMessage(err, "Workflow cronjob failed."));
    }
}

async function revealRunForUserInput(runId: string): Promise<void> {
    const updatedAt = Number(nowMs());
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        select: { session_id: true },
    });
    if (!run?.session_id) return;
    await prisma.chat_sessions.update({
        where: { id: run.session_id },
        data: {
            visible_to_user: true,
            updated_at: updatedAt,
        },
    });
}

async function cronjobSessionHasPendingUserInput(opencodeSessionId: string): Promise<boolean> {
    const pendingQuestions = await listPendingQuestions();
    if (pendingQuestions.some((question) => question.sessionID === opencodeSessionId)) {
        return true;
    }

    const pendingPermissions = await listPendingPermissions();
    if (pendingPermissions.some((permission) => permission.sessionID === opencodeSessionId)) {
        return true;
    }

    const customPendingPermission = await prisma.tool_execution_permissions.findFirst({
        where: {
            opencode_session_id: opencodeSessionId,
            status: "pending",
        },
        select: { id: true },
    });
    return customPendingPermission !== null;
}

function monitorCronjobRun(runId: string, opencodeSessionId: string, timeoutAtMs: number): void {
    if (runningMonitors.has(runId)) return;

    let revealedForUserInput = false;
    const interval = setInterval(async () => {
        try {
            const run = await prisma.cronjob_runs.findUnique({
                where: { id: runId },
                select: { status: true }
            });
            if (!run || run.status !== "running") {
                clearInterval(interval);
                runningMonitors.delete(runId);
                return;
            }

            if (Date.now() >= timeoutAtMs) {
                await markCronjobRunFailed(runId, "Cronjob run timed out after 1.5x the configured interval.");
                clearInterval(interval);
                runningMonitors.delete(runId);
                return;
            }

            if (await cronjobSessionHasPendingUserInput(opencodeSessionId)) {
                if (!revealedForUserInput) {
                    await revealRunForUserInput(runId);
                    revealedForUserInput = true;
                }
                return;
            }

            const client = await getOpencodeClient();
            const statusResult = await client.session.status();
            if (statusResult.error) {
                await markCronjobRunFailed(runId, getErrorMessage(statusResult.error, "Failed to get cronjob session status."));
                clearInterval(interval);
                runningMonitors.delete(runId);
                return;
            }
            const sessionStatusType = getSessionStatusTypeForSession(
                statusResult.data as SessionStatusMap,
                opencodeSessionId
            );
            if (sessionStatusType !== "idle") return;

            if (!revealedForUserInput) {
                // Cronjob completion is signaled only by markCronjobCompleted, which updates the
                // run out of "running". If the opencode session falls idle while the run is still
                // running, the agent stopped making tool calls without completing the cronjob, so
                // reveal the linked chat session and let the user take over from there.
                await revealRunForUserInput(runId);
                revealedForUserInput = true;
            }
        } catch (err) {
            await markCronjobRunFailed(runId, getErrorMessage(err, "Failed to monitor cronjob run."));
            console.error("Failed to monitor cronjob run:", err);
            clearInterval(interval);
            runningMonitors.delete(runId);
        }
    }, CRONJOB_MONITOR_INTERVAL_MS);
    runningMonitors.set(runId, interval);
}

export async function dispatchCronjobRun(cronjobId: string, mode: CronjobDispatchMode = "scheduled"): Promise<string> {
    const cronjob = await prisma.cronjobs.findUnique({
        where: { id: cronjobId },
        include: { user: true },
    });
    if (!cronjob) {
        throw new Error("Cronjob not found");
    }
    if (!cronjob.enabled && mode === "scheduled") {
        throw new Error("Cronjob is disabled");
    }

    const activeRun = await prisma.cronjob_runs.findFirst({
        where: {
            cronjob_id: cronjob.id,
            status: "running",
        },
        select: { id: true }
    });
    if (activeRun) {
        if (mode === "scheduled") {
            return await createSkippedCronjobRun(cronjob.id);
        }
        throw {
            status: 409,
            message: "Cronjob is already running. Wait for the active run to finish, or stop it and run this cronjob again."
        };
    }

    if (cronjob.target_type === "workflow") {
        const now = nowMs();
        const run = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
            },
        });
        try {
            const workflowSlug = assertNonEmptyString(cronjob.workflow_slug, "workflow_slug");
            const workflowInputs = parseWorkflowInputJson(cronjob.workflow_input_json);
            await assertUserCanRunWorkflow(workflowSlug, cronjob.user_id);
            const startedRun = await startWorkflowRunViaBackend({
                workspaceDir: getWorkspaceDirFromEnv(),
                slug: workflowSlug,
                inputs: workflowInputs,
                authUserId: cronjob.user_id,
                sessionId: `cronjob-${run.id}`,
                messageId: `cronjob-message-${randomUUID()}`,
                callId: `cronjob-call-${randomUUID()}`,
                requirePermissionPrompt: false,
                secretResolutionMode: "user",
                runSource: "cronjob",
            });
            await prisma.cronjob_runs.update({
                where: { id: run.id },
                data: { workflow_run_id: startedRun.runId },
            });
            void finishWorkflowCronjobRun(run.id, startedRun.completion);
            return run.id;
        } catch (err) {
            await markCronjobRunFailed(run.id, getErrorMessage(err, "Failed to start workflow cronjob."));
            return run.id;
        }
    }

    const userPrompt = cronjob.prompt;
    if (!userPrompt) {
        throw new Error("Prompt cronjob target is missing prompt");
    }

    const client = await getOpencodeClient();
    const sessionResult = await client.session.create();
    if (sessionResult.error || !sessionResult.data) {
        throw new Error("Failed to create opencode session for cronjob");
    }

    const now = nowMs();
    const chatSession = await prisma.chat_sessions.create({
        data: {
            user_id: cronjob.user_id,
            opencode_session_id: sessionResult.data.id,
            title: `Cronjob: ${cronjob.name}`,
            visible_to_user: false,
            created_at: Number(now),
            updated_at: Number(now),
        },
    });
    const run = await prisma.cronjob_runs.create({
        data: {
            cronjob_id: cronjob.id,
            status: "running",
            started_at: now,
            opencode_session_id: sessionResult.data.id,
            session_id: chatSession.id,
        },
    });

    const runtimePrompt = await buildCronjobPrompt({
        cronjobName: cronjob.name,
        cronjobPrompt: userPrompt,
        userId: cronjob.user_id,
    });
    const promptResult = await client.session.promptAsync({
        path: { id: sessionResult.data.id },
        body: {
            parts: [{ type: "text", text: runtimePrompt }],
        },
    });
    if (promptResult.error) {
        await markCronjobRunFailed(run.id, "Failed to start cronjob opencode prompt.");
        throw new Error("Failed to send cronjob prompt to opencode");
    }

    monitorCronjobRun(run.id, sessionResult.data.id, getCronjobTimeoutAt({
        cron_expression: cronjob.cron_expression,
        timezone: cronjob.timezone,
    }, Number(now)));
    return run.id;
}

export function scheduleOneCronjob(cronjob: {
    id: string;
    cron_expression: string;
    timezone: string;
    enabled: boolean;
}): void {
    const existing = scheduledJobs.get(cronjob.id);
    if (existing) {
        void existing.stop();
        scheduledJobs.delete(cronjob.id);
    }
    if (!cronjob.enabled) return;
    const schedule: CronjobSchedule = cronjob;
    const expression = toCronPackageExpression(schedule.cron_expression);
    const job = new CronJob(expression, () => {
        void dispatchCronjobRun(cronjob.id, "scheduled").catch((err) => {
            console.error(`Failed to dispatch cronjob ${cronjob.id}:`, err);
        });
    }, null, false, schedule.timezone);
    job.start();
    scheduledJobs.set(cronjob.id, job);
}

export async function startUserCronjobScheduler(): Promise<void> {
    const cronjobs = await prisma.cronjobs.findMany({
        where: { enabled: true },
        select: {
            id: true,
            cron_expression: true,
            timezone: true,
            enabled: true,
        }
    });
    for (const cronjob of cronjobs) {
        scheduleOneCronjob(cronjob);
    }
}

export async function completeCurrentCronjobRun(opencodeSessionId: string, summary: string): Promise<void> {
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            opencode_session_id: opencodeSessionId,
        },
    });
    if (!run) {
        throw {
            status: 404,
            message: "This is not a cronjob session. If this was called via the markCronjobCompleted tool, then do not use this tool again."
        };
    }
    if (run.status !== "running") {
        throw {
            status: 404,
            message: `Cronjob is not in running state. Current state is: ${run.status}`
        };
    }

    await prisma.cronjob_runs.update({
        where: { id: run.id },
        data: {
            status: "success",
            completed_at: nowMs(),
            summary,
        },
    });
}

import { CronJob, CronTime } from "cron";
import { randomUUID } from "crypto";
import prisma from "../prisma/client";
import { Prisma } from "../../prisma/generated/client";
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
    buildCurrentTimePrompt,
} from "../utils/chat-prompt-context";
import type { CronjobMonitorTimeoutUnit, CronjobSchedule, CronjobTargetType } from "../types/cronjob";
import { assertUserCanRunWorkflow } from "../utils/workflow-run-validation";
import { abortOpencodeSession } from "../utils/session-abort";
import { markWorkflowSessionAborted } from "../utils/workflow-interruption";

const CRONJOB_MONITOR_INTERVAL_MS = 5000;

const scheduledJobs = new Map<string, CronJob>();
const runningMonitors = new Map<string, NodeJS.Timeout | null>();
type CronjobDispatchMode = "scheduled" | "manual";

function nowMs(): bigint {
    return BigInt(Date.now());
}

function throwCronjobAlreadyActive(): never {
    throw {
        status: 409,
        message: "Cronjob already has an active run. Wait for it to finish, resume it, or terminate it first."
    };
}

function isRunningRunUniquenessError(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function throwIfRunningRunUniquenessError(err: unknown): never {
    if (isRunningRunUniquenessError(err)) {
        throwCronjobAlreadyActive();
    }
    throw err;
}

async function abortOpencodeSessionBestEffort(opencodeSessionId: string): Promise<void> {
    try {
        await abortOpencodeSession(opencodeSessionId);
    } catch (err) {
        console.error("Failed to abort OpenCode session after cronjob state transition:", err);
    }
}

async function markWorkflowSessionAbortedBestEffort(sessionId: string): Promise<void> {
    try {
        await markWorkflowSessionAborted(sessionId);
    } catch (err) {
        console.error("Failed to abort workflow session after cronjob state transition:", err);
    }
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

function assertMonitorTimeoutUnit(value: unknown): CronjobMonitorTimeoutUnit {
    if (value !== "minutes" && value !== "hours" && value !== "days") {
        throw {
            status: 400,
            message: "monitor_timeout_unit must be minutes, hours, or days"
        };
    }
    return value;
}

function assertMonitorTimeoutValue(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw {
            status: 400,
            message: "monitor_timeout_value must be a non-negative number"
        };
    }
    return value;
}

export function validateCronjobMonitorTimeout(input: {
    monitor_timeout_value?: unknown;
    monitor_timeout_unit?: unknown;
}): {
    monitorTimeoutValue: number;
    monitorTimeoutUnit: CronjobMonitorTimeoutUnit;
} {
    return {
        monitorTimeoutValue: input.monitor_timeout_value === undefined ? 2 : assertMonitorTimeoutValue(input.monitor_timeout_value),
        monitorTimeoutUnit: input.monitor_timeout_unit === undefined ? "hours" : assertMonitorTimeoutUnit(input.monitor_timeout_unit),
    };
}

function monitorTimeoutToMs(value: number, unit: CronjobMonitorTimeoutUnit): number {
    if (unit === "minutes") return value * 60_000;
    if (unit === "hours") return value * 3_600_000;
    return value * 86_400_000;
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

function getCronjobTimeoutAt(timeoutValue: number, timeoutUnit: CronjobMonitorTimeoutUnit, startedAtMs: number): number {
    return startedAtMs + monitorTimeoutToMs(timeoutValue, timeoutUnit);
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
        "First thing you must do is understand the task. If it refers to skills / workflows, read them first. Then call getCronjobTodos to fetch the current todo_list_version, and based on the instructions from the task and the files you read, call addCronjobTodos with a granular todo list. Do not start executing the task until TeamCopilot gives you the first current todo item.",
        "The todo list is editable by you. Use getCurrentCronjobTodo to inspect the current todo (returns up to one item with its id) and getCronjobTodos to inspect the active todo list (returns all active todo ids, contents, and a todo_list_version snapshot token).",
        "Use addCronjobTodos to insert new todo items anywhere in the active todo list, and always pass the todo_list_version returned by the most recent getCronjobTodos call. Use clearCronjobTodos to remove one or more active todo items from the list by todo id.",
        "After planning, TeamCopilot will give you exactly one current todo item at a time in this same session.",
        "When working on a current todo item, work only on that item. If you discover more required work, call addCronjobTodos or clearCronjobTodos as needed. Refer to todos by id, not by position.",
        "When the current todo item is complete, call finishCurrentCronjobTodo with a concise completion summary and then stop. TeamCopilot will give you the next todo item.",
        "Keep working until every todo item needed for the requested cronjob task is complete or the loop is blocked by a real permission, tool question, or safety boundary.",
        "Do not ask the user questions unless the task explicitly requires user approval or clarification that cannot be safely inferred.",
        "If you need to ask the user for input or notify them that the cronjob needs their attention, call askCronjobUser with the message. This reveals the hidden cronjob chat to the user and pauses the auto-continue loop until the user explicitly resumes the cronjob.",
        "If the task cannot be finished because of a non-recoverable issue, call markCronjobFailed with a concise reason instead of leaving the run hanging.",
        "The only way to mark this cronjob finished successfully is to call the markCronjobCompleted tool.",
        "markCronjobCompleted will fail until all TeamCopilot cronjob todos have been finished.",
        "Call markCronjobCompleted only after the requested work is 100% complete.",
        "The completion summary must be concise and suitable for cronjob run history.",
    ];
    sections.push("", buildCurrentTimePrompt());
    const availableSkillsPrompt = await buildAvailableSkillsPrompt(args.userId);
    const availableSecretsPrompt = await buildAvailableSecretsPrompt(args.userId);
    if (availableSkillsPrompt) sections.push("", availableSkillsPrompt);
    if (availableSecretsPrompt) sections.push("", availableSecretsPrompt);
    sections.push("", ACTUAL_USER_MESSAGE_MARKER, "", "# Cronjob task", "", `Name: ${args.cronjobName}`, "", args.cronjobPrompt);
    sections.push("");
    sections.push("Current task: Understand the task requirements (based on the above task (read skill files / workflows if needed), and create a granular todo list with addCronjobTodos. Then stop - only start the first todo once the system prompts you with the todo item.")
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

type CronjobTodoForPrompt = {
    id: string;
    content: string;
    position: number;
};

async function getCurrentCronjobTodo(runId: string): Promise<CronjobTodoForPrompt | null> {
    return prisma.cronjob_run_todos.findFirst({
        where: { run_id: runId, status: "in_progress" },
        orderBy: { position: "asc" },
        select: { id: true, content: true, position: true },
    });
}

async function getNextPendingCronjobTodo(runId: string): Promise<CronjobTodoForPrompt | null> {
    return prisma.cronjob_run_todos.findFirst({
        where: { run_id: runId, status: "pending" },
        orderBy: { position: "asc" },
        select: { id: true, content: true, position: true },
    });
}

async function getCronjobTodoCount(runId: string): Promise<number> {
    return prisma.cronjob_run_todos.count({ where: { run_id: runId } });
}

async function startCronjobTodo(runId: string, todoId: string): Promise<CronjobTodoForPrompt> {
    return prisma.$transaction(async (tx) => {
        const todo = await tx.cronjob_run_todos.update({
            where: { id: todoId },
            data: { status: "in_progress" },
            select: { id: true, content: true, position: true },
        });
        await tx.cronjob_runs.update({
            where: { id: runId },
            data: { todo_list_version: { increment: 1 } },
        });
        return todo;
    });
}

function buildCronjobPlanningReminderPrompt(): string {
    return [
        "# Cronjob planning required",
        "",
        "You must create the TeamCopilot cronjob todo list before doing any task work.",
        "Call getCronjobTodos first to fetch the current todo_list_version, then call addCronjobTodos with granular todo items that cover the requested cronjob task.",
        "Do not execute the task yet. TeamCopilot will give you the first current todo item after the todo list is saved."
    ].join("\n");
}

function buildCronjobCurrentTodoPrompt(todo: CronjobTodoForPrompt): string {
    return [
        "# Current cronjob todo",
        "",
        `Todo ${todo.position + 1}: ${todo.content}`,
        "",
        "Work only on this todo item.",
        "If you discover additional required work, call getCronjobTodos first if you need a fresh todo snapshot, then call addCronjobTodos with the returned todo_list_version.",
        "If you want to inspect the current todo again, use getCurrentCronjobTodo.",
        "When this todo item is fully complete, call finishCurrentCronjobTodo with a concise completion summary, then stop.",
        "Do not work on later todo items until TeamCopilot gives them to you.",
        "Do not call markCronjobCompleted while a current todo item is active."
    ].join("\n");
}

function buildCronjobCurrentTodoContinuationPrompt(todo: CronjobTodoForPrompt, iteration: number): string {
    return [
        "# Cronjob continuation",
        "",
        `The cronjob monitor found this session idle while the current todo is still active. This is continuation attempt ${iteration}.`,
        "",
        `Current todo: ${todo.content}`,
        "",
        "Continue this todo item only.",
        "If this todo item is complete, call finishCurrentCronjobTodo with a concise completion summary, then stop.",
        "If more work is required, take the next concrete step for this todo item.",
        "If you discover additional required work, call getCronjobTodos first if you need a fresh todo snapshot, then call addCronjobTodos or clearCronjobTodos.",
        "If the task cannot continue, call markCronjobFailed.",
        "If you truly need user input that cannot be safely inferred, call askCronjobUser with the message for the user.",
        "",
        "Do not switch to another todo item."
    ].join("\n");
}

function buildCronjobFinalReviewPrompt(): string {
    return [
        "# Cronjob final review",
        "",
        "All TeamCopilot cronjob todos are marked complete.",
        "Review the original cronjob task and the work completed in this session.",
        "If the requested task is 100% complete, call markCronjobCompleted with a concise run-history summary.",
        "If required work is still missing, call getCronjobTodos first if you need a fresh todo snapshot, then call addCronjobTodos with the new todo items.",
        "If the task cannot be completed, call markCronjobFailed with a concise reason.",
        "If you truly need user input that cannot be safely inferred, call askCronjobUser with the message for the user."
    ].join("\n");
}

async function monitorCronjobRun(runId: string, opencodeSessionId: string, timeoutAtMs: number): Promise<void> {
    if (runningMonitors.has(runId)) return;
    runningMonitors.set(runId, null);

    let revealedForUserInput = false;
    let isChecking = false;
    let continuationCount = 0;
    let interval: NodeJS.Timeout;
    const check = async () => {
        if (isChecking) {
            return;
        }
        isChecking = true;
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
                await markCronjobRunFailed(runId, "Cronjob run timed out after the configured monitor timeout.");
                await abortOpencodeSessionBestEffort(opencodeSessionId);
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

            const todoCount = await getCronjobTodoCount(runId);
            if (todoCount === 0) {
                const planningResult = await client.session.promptAsync({
                    path: { id: opencodeSessionId },
                    body: {
                        parts: [{ type: "text", text: buildCronjobPlanningReminderPrompt() }],
                    },
                });
                if (planningResult.error) {
                    await markCronjobRunFailed(runId, getErrorMessage(planningResult.error, "Failed to prompt cronjob todo planning."));
                    clearInterval(interval);
                    runningMonitors.delete(runId);
                }
                return;
            }

            const currentTodo = await getCurrentCronjobTodo(runId);
            if (currentTodo) {
                continuationCount += 1;
                const continueResult = await client.session.promptAsync({
                    path: { id: opencodeSessionId },
                    body: {
                        parts: [{ type: "text", text: buildCronjobCurrentTodoContinuationPrompt(currentTodo, continuationCount) }],
                    },
                });
                if (continueResult.error) {
                    await markCronjobRunFailed(runId, getErrorMessage(continueResult.error, "Failed to continue idle cronjob todo."));
                    clearInterval(interval);
                    runningMonitors.delete(runId);
                }
                return;
            }

            const pendingTodo = await getNextPendingCronjobTodo(runId);
            if (pendingTodo) {
                continuationCount = 0;
                const startedTodo = await startCronjobTodo(runId, pendingTodo.id);
                const todoResult = await client.session.promptAsync({
                    path: { id: opencodeSessionId },
                    body: {
                        parts: [{ type: "text", text: buildCronjobCurrentTodoPrompt(startedTodo) }],
                    },
                });
                if (todoResult.error) {
                    await markCronjobRunFailed(runId, getErrorMessage(todoResult.error, "Failed to prompt next cronjob todo."));
                    clearInterval(interval);
                    runningMonitors.delete(runId);
                }
                return;
            }

            const continueResult = await client.session.promptAsync({
                path: { id: opencodeSessionId },
                body: {
                    parts: [{ type: "text", text: buildCronjobFinalReviewPrompt() }],
                },
            });
            if (continueResult.error) {
                await markCronjobRunFailed(runId, getErrorMessage(continueResult.error, "Failed to prompt cronjob final review."));
                clearInterval(interval);
                runningMonitors.delete(runId);
            }
        } catch (err) {
            await markCronjobRunFailed(runId, getErrorMessage(err, "Failed to monitor cronjob run."));
            console.error("Failed to monitor cronjob run:", err);
            clearInterval(interval);
            runningMonitors.delete(runId);
        } finally {
            isChecking = false;
        }
    };
    interval = setInterval(() => {
        void check();
    }, CRONJOB_MONITOR_INTERVAL_MS);
    runningMonitors.set(runId, interval);
}

export async function resumeCronjobRun(runId: string): Promise<void> {
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        include: {
            cronjob: {
                select: {
                    target_type: true,
                    monitor_timeout_value: true,
                    monitor_timeout_unit: true,
                },
            },
        },
    });
    if (!run) {
        throw {
            status: 404,
            message: "Cronjob run not found"
        };
    }
    if (run.cronjob.target_type !== "prompt" || !run.opencode_session_id || !run.session_id) {
        throw {
            status: 400,
            message: "Only prompt cronjob chats can be resumed."
        };
    }
    if (run.status !== "paused") {
        throw {
            status: 400,
            message: `Only paused prompt cronjob runs can be resumed. Current status is: ${run.status}`
        };
    }
    const opencodeSessionId = run.opencode_session_id;
    const sessionId = run.session_id;
    try {
        await prisma.$transaction(async (tx) => {
            const resumedRun = await tx.cronjob_runs.updateMany({
                where: { id: run.id, status: "paused" },
                data: {
                    status: "running",
                    completed_at: null,
                    error_message: null,
                    summary: null,
                },
            });
            if (resumedRun.count !== 1) {
                throw {
                    status: 409,
                    message: "Cronjob run is no longer paused."
                };
            }
            await tx.chat_sessions.update({
                where: { id: sessionId },
                data: { updated_at: Number(nowMs()) },
            });
        });
    } catch (err) {
        throwIfRunningRunUniquenessError(err);
    }

    await monitorCronjobRun(
        run.id,
        opencodeSessionId,
        getCronjobTimeoutAt(
            run.cronjob.monitor_timeout_value,
            assertMonitorTimeoutUnit(run.cronjob.monitor_timeout_unit),
            Number(run.started_at),
        )
    );
}

async function recoverRunningPromptCronjobRun(runId: string): Promise<void> {
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        include: {
            cronjob: {
                select: {
                    target_type: true,
                    monitor_timeout_value: true,
                    monitor_timeout_unit: true,
                },
            },
        },
    });
    if (!run || run.status !== "running" || run.cronjob.target_type !== "prompt" || !run.opencode_session_id) return;
    await monitorCronjobRun(
        run.id,
        run.opencode_session_id,
        getCronjobTimeoutAt(
            run.cronjob.monitor_timeout_value,
            assertMonitorTimeoutUnit(run.cronjob.monitor_timeout_unit),
            Number(run.started_at),
        )
    );
}

export async function interruptCronjobRun(runId: string): Promise<void> {
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        include: {
            cronjob: { select: { target_type: true } },
        },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    if (run.cronjob.target_type !== "prompt" || !run.opencode_session_id || !run.session_id) {
        throw { status: 400, message: "Only prompt cronjob runs can be interrupted." };
    }
    if (run.status !== "running") {
        throw { status: 400, message: `Only running cronjob runs can be interrupted. Current status is: ${run.status}` };
    }
    const sessionId = run.session_id;
    const opencodeSessionId = run.opencode_session_id;

    await prisma.$transaction(async (tx) => {
        const interruptedRun = await tx.cronjob_runs.updateMany({
            where: { id: run.id, status: "running" },
            data: { status: "paused" },
        });
        if (interruptedRun.count !== 1) {
            throw { status: 409, message: "Cronjob run is no longer running." };
        }
        await tx.chat_sessions.update({
            where: { id: sessionId },
            data: {
                visible_to_user: true,
                updated_at: Number(nowMs()),
            },
        });
    });
    await abortOpencodeSessionBestEffort(opencodeSessionId);
}

export async function terminateCronjobRun(runId: string): Promise<void> {
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        include: {
            cronjob: { select: { target_type: true } },
        },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    if (!["running", "paused"].includes(run.status)) {
        return;
    }

    const terminatedRun = await prisma.cronjob_runs.updateMany({
        where: {
            id: run.id,
            status: { in: ["running", "paused"] },
        },
        data: {
            status: run.cronjob.target_type === "prompt" ? "terminated" : "failed",
            completed_at: nowMs(),
            error_message: "Cronjob run was terminated by the user.",
        },
    });
    if (terminatedRun.count !== 1) {
        return;
    }

    if (run.cronjob.target_type === "prompt") {
        if (run.status === "running") {
            await abortOpencodeSessionBestEffort(run.opencode_session_id!);
        }
        return;
    }

    const workflowRun = await prisma.workflow_runs.findUnique({
        where: { id: run.workflow_run_id! },
        select: { session_id: true },
    });
    if (workflowRun?.session_id) {
        await markWorkflowSessionAbortedBestEffort(workflowRun.session_id);
    }
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
            status: { in: ["running", "paused"] },
        },
        select: { id: true }
    });
    if (activeRun) {
        if (mode === "scheduled") {
            return await createSkippedCronjobRun(cronjob.id);
        }
        throwCronjobAlreadyActive();
    }

    if (cronjob.target_type === "workflow") {
        const now = nowMs();
        let run: { id: string };
        try {
            run = await prisma.cronjob_runs.create({
                data: {
                    cronjob_id: cronjob.id,
                    status: "running",
                    started_at: now,
                },
                select: { id: true },
            });
        } catch (err) {
            if (isRunningRunUniquenessError(err) && mode === "scheduled") {
                return await createSkippedCronjobRun(cronjob.id);
            }
            throwIfRunningRunUniquenessError(err);
        }
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
    let run: { id: string };
    try {
        run = await prisma.$transaction(async (tx) => {
            const chatSession = await tx.chat_sessions.create({
                data: {
                    user_id: cronjob.user_id,
                    opencode_session_id: sessionResult.data.id,
                    title: `Cronjob: ${cronjob.name}`,
                    visible_to_user: false,
                    created_at: Number(now),
                    updated_at: Number(now),
                },
                select: { id: true },
            });
            return await tx.cronjob_runs.create({
                data: {
                    cronjob_id: cronjob.id,
                    status: "running",
                    started_at: now,
                    opencode_session_id: sessionResult.data.id,
                    session_id: chatSession.id,
                },
                select: { id: true },
            });
        });
    } catch (err) {
        if (isRunningRunUniquenessError(err) && mode === "scheduled") {
            return await createSkippedCronjobRun(cronjob.id);
        }
        throwIfRunningRunUniquenessError(err);
    }

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

    await monitorCronjobRun(
        run.id,
        sessionResult.data.id,
        getCronjobTimeoutAt(
            cronjob.monitor_timeout_value,
            assertMonitorTimeoutUnit(cronjob.monitor_timeout_unit),
            Number(now),
        )
    );
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
    const recoverablePromptRuns = await prisma.cronjob_runs.findMany({
        where: {
            status: "running",
            opencode_session_id: { not: null },
            cronjob: { target_type: "prompt" },
        },
        select: { id: true },
    });
    for (const run of recoverablePromptRuns) {
        await recoverRunningPromptCronjobRun(run.id);
    }

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
    const runs = await prisma.cronjob_runs.findMany({
        where: {
            opencode_session_id: opencodeSessionId,
            cronjob: { target_type: "prompt" },
        },
    });
    if (runs.length === 0) {
        throw {
            status: 404,
            message: "This is not a cronjob session. If this was called via the markCronjobCompleted tool, then do not use this tool again."
        };
    }
    if (runs.length > 1) {
        throw {
            status: 500,
            message: "Invariant violation: multiple prompt cronjob runs share one OpenCode session."
        };
    }
    const run = runs[0];
    if (!["running", "paused"].includes(run.status)) {
        throw {
            status: 404,
            message: `Cronjob is not active. Current state is: ${run.status}`
        };
    }
    const unfinishedTodo = await prisma.cronjob_run_todos.findFirst({
        where: {
            run_id: run.id,
            status: { not: "completed" },
        },
        orderBy: { position: "asc" },
        select: { content: true, status: true },
    });
    if (unfinishedTodo) {
        throw {
            status: 400,
            message: `Cronjob still has an unfinished todo (${unfinishedTodo.status}): ${unfinishedTodo.content}`
        };
    }
    const todoCount = await prisma.cronjob_run_todos.count({
        where: { run_id: run.id },
    });
    if (todoCount === 0) {
        throw {
            status: 400,
            message: "Cronjob cannot be marked complete before addCronjobTodos has created and finishCurrentCronjobTodo has completed the todo list."
        };
    }

    const completedRun = await prisma.cronjob_runs.updateMany({
        where: { id: run.id, status: { in: ["running", "paused"] } },
        data: {
            status: "success",
            completed_at: nowMs(),
            summary,
        },
    });
    if (completedRun.count !== 1) {
        throw {
            status: 409,
            message: "Cronjob run is no longer active."
        };
    }
}

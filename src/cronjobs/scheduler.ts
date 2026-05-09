import { CronJob, CronTime } from "cron";
import { randomUUID } from "crypto";
import prisma from "../prisma/client";
import { getOpencodeClient } from "../utils/opencode-client";
import { getResourceAccessSummary } from "../utils/resource-access";
import { listSkillSlugs, readSkillManifestAndEnsurePermissions } from "../utils/skill";
import { listResolvedSecretsForUser } from "../utils/secrets";
import { getWorkspaceDirFromEnv } from "../utils/workspace-sync";
import { startWorkflowRunViaBackend } from "../utils/workflow-runner";
import {
    getSessionStatusTypeForSession,
    type SessionStatusMap,
} from "../utils/chat-session";
import {
    getPendingQuestionForSession,
    listPendingPermissionsForSession,
} from "../utils/opencode-client";

const CRONJOB_MONITOR_INTERVAL_MS = 5000;

type CronjobSchedule = {
    cron_expression: string;
    timezone: string;
};

type CronjobTarget = {
    target_type: string;
    prompt: string | null;
    prompt_allow_workflow_runs_without_permission: boolean | null;
    workflow_slug: string | null;
    workflow_input_json: string | null;
};

const scheduledJobs = new Map<string, CronJob>();
const runningMonitors = new Map<string, NodeJS.Timeout>();

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

export function getCronjobEffectiveExpression(schedule: {
    cron_expression: string;
}): string {
    return schedule.cron_expression;
}

export function getNextRunAt(schedule: CronjobSchedule): number {
    const expression = toCronPackageExpression(getCronjobEffectiveExpression(schedule));
    const cronTime = new CronTime(expression, schedule.timezone);
    return cronTime.sendAt().toMillis();
}

async function buildAvailableSkillsPrompt(userId: string): Promise<string | null> {
    const slugs = listSkillSlugs();
    if (slugs.length === 0) return null;

    const availableSkills = (await Promise.all(slugs.map(async (slug) => {
        const accessSummary = await getResourceAccessSummary("skill", slug, userId);
        if (!accessSummary.can_view || !accessSummary.is_approved) return null;
        const { manifest } = await readSkillManifestAndEnsurePermissions(slug);
        return `${manifest.name} (${slug}) - ${manifest.description || "(no description provided)"}`;
    }))).filter((line): line is string => line !== null);

    if (availableSkills.length === 0) return null;
    return `# Available custom skills\n\n${availableSkills.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
}

async function buildAvailableSecretsPrompt(userId: string): Promise<string | null> {
    const secretMap = await listResolvedSecretsForUser(userId);
    const keys = Object.keys(secretMap);
    if (keys.length === 0) return null;
    return [
        "# Available secrets for this user",
        "",
        "Use proxy placeholders like {{SECRET:KEY}} when referring to secrets. Do not print or expose secret values.",
        `Available secret keys: ${keys.join(", ")}`,
    ].join("\n");
}

async function buildCronjobPrompt(args: {
    cronjobName: string;
    cronjobPrompt: string;
    allowWorkflowRunsWithoutPermission: boolean;
    userId: string;
}): Promise<string> {
    const sections = [
        "# Cronjob runtime instructions",
        "",
        "This is an unattended scheduled TeamCopilot cronjob run.",
        "Keep working until the requested cronjob task is complete or the tool loop is blocked by a real permission, tool question, or safety boundary.",
        "Do not ask the user questions in normal prose. Make reasonable assumptions and continue when safe.",
        "The only way to mark this cronjob finished is to call the markCronjobCompleted tool.",
        "If the tool loop stops without markCronjobCompleted being called, TeamCopilot will reveal this session to the user as needing attention.",
        "Call markCronjobCompleted only after the requested work is actually complete.",
        "The completion summary must be concise and suitable for cronjob run history.",
        `Workflow permission policy: ${args.allowWorkflowRunsWithoutPermission ? "workflow runs may proceed without an extra user permission prompt" : "workflow runs should require user permission when the workflow tool would normally ask"}.`,
    ];
    const availableSkillsPrompt = await buildAvailableSkillsPrompt(args.userId);
    const availableSecretsPrompt = await buildAvailableSecretsPrompt(args.userId);
    if (availableSkillsPrompt) sections.push("", availableSkillsPrompt);
    if (availableSecretsPrompt) sections.push("", availableSecretsPrompt);
    sections.push("", "# Cronjob", "", `Name: ${args.cronjobName}`, "", args.cronjobPrompt);
    return sections.join("\n");
}

function getCronjobTarget(cronjob: {
    target_type: string;
    prompt: string | null;
    prompt_allow_workflow_runs_without_permission: boolean | null;
    workflow_slug: string | null;
    workflow_input_json: string | null;
}): CronjobTarget {
    return {
        target_type: cronjob.target_type,
        prompt: cronjob.prompt,
        prompt_allow_workflow_runs_without_permission: cronjob.prompt_allow_workflow_runs_without_permission,
        workflow_slug: cronjob.workflow_slug,
        workflow_input_json: cronjob.workflow_input_json,
    };
}

function parseWorkflowInputJson(value: string | null): Record<string, unknown> {
    if (value === null || value.trim().length === 0) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Workflow input JSON must be an object");
    }
    return parsed as Record<string, unknown>;
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
        await prisma.cronjob_runs.updateMany({
            where: { id: cronjobRunId, status: "running" },
            data: {
                status: "failed",
                completed_at: nowMs(),
                error_message: err instanceof Error ? err.message : "Workflow cronjob failed.",
            },
        });
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

function monitorCronjobRun(runId: string, opencodeSessionId: string): void {
    if (runningMonitors.has(runId)) return;

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

            const client = await getOpencodeClient();
            const statusResult = await client.session.status();
            if (statusResult.error) return;
            const sessionStatusType = getSessionStatusTypeForSession(
                statusResult.data as SessionStatusMap,
                opencodeSessionId
            );
            if (sessionStatusType !== "idle") return;

            await revealRunForUserInput(runId);
            clearInterval(interval);
            runningMonitors.delete(runId);
        } catch (err) {
            console.error("Failed to monitor cronjob run:", err);
        }
    }, CRONJOB_MONITOR_INTERVAL_MS);
    runningMonitors.set(runId, interval);
}

export async function dispatchCronjobRun(cronjobId: string, options: { allowDisabled?: boolean; skipIfActive?: boolean } = {}): Promise<string> {
    const cronjob = await prisma.cronjobs.findUnique({
        where: { id: cronjobId },
        include: { user: true },
    });
    if (!cronjob || (!cronjob.enabled && options.allowDisabled !== true)) {
        throw new Error("Cronjob not found or disabled");
    }

    const activeRun = await prisma.cronjob_runs.findFirst({
        where: {
            cronjob_id: cronjob.id,
            status: "running",
        },
        select: { id: true }
    });
    if (activeRun) {
        if (options.skipIfActive === false) {
            throw {
                status: 409,
                message: "Cronjob is already running"
            };
        }
        const now = nowMs();
        const skipped = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "skipped",
                started_at: now,
                completed_at: now,
                error_message: "Previous run is still active.",
            },
        });
        return skipped.id;
    }

    const target = getCronjobTarget(cronjob);
    if (target.target_type === "workflow") {
        if (!target.workflow_slug) {
            throw new Error("Workflow cronjob target is missing workflow_slug");
        }
        const workflowInputJson = target.workflow_input_json ?? "{}";
        const now = nowMs();
        const run = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now,
            },
        });
        try {
            const startedRun = await startWorkflowRunViaBackend({
                workspaceDir: getWorkspaceDirFromEnv(),
                slug: target.workflow_slug,
                inputs: parseWorkflowInputJson(workflowInputJson),
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
            await prisma.cronjob_runs.update({
                where: { id: run.id },
                data: {
                    status: "failed",
                    completed_at: nowMs(),
                    error_message: err instanceof Error ? err.message : "Failed to start workflow cronjob.",
                },
            });
            return run.id;
        }
    }

    const userPrompt = target.prompt;
    if (!userPrompt) {
        throw new Error("Prompt cronjob target is missing prompt");
    }

    const client = await getOpencodeClient();
    const sessionResult = await client.session.create();
    if (sessionResult.error || !sessionResult.data) {
        throw new Error("Failed to create opencode session for cronjob");
    }

    const now = nowMs();
    const run = await prisma.cronjob_runs.create({
        data: {
            cronjob_id: cronjob.id,
            status: "running",
            started_at: now,
            opencode_session_id: sessionResult.data.id,
        },
    });
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
    await prisma.cronjob_runs.update({
        where: { id: run.id },
        data: { session_id: chatSession.id },
    });

    const runtimePrompt = await buildCronjobPrompt({
        cronjobName: cronjob.name,
        cronjobPrompt: userPrompt,
        allowWorkflowRunsWithoutPermission: target.prompt_allow_workflow_runs_without_permission ?? true,
        userId: cronjob.user_id,
    });
    const promptResult = await client.session.promptAsync({
        path: { id: sessionResult.data.id },
        body: {
            parts: [{ type: "text", text: runtimePrompt }],
        },
    });
    if (promptResult.error) {
        const completedAt = nowMs();
        await prisma.cronjob_runs.update({
            where: { id: run.id },
            data: {
                status: "failed",
                completed_at: completedAt,
                error_message: "Failed to start cronjob opencode prompt.",
            },
        });
        throw new Error("Failed to send cronjob prompt to opencode");
    }

    monitorCronjobRun(run.id, sessionResult.data.id);
    return run.id;
}

function scheduleOneCronjob(cronjob: {
    id: string;
    cron_expression: string;
    timezone: string;
}): void {
    const existing = scheduledJobs.get(cronjob.id);
    if (existing) {
        void existing.stop();
        scheduledJobs.delete(cronjob.id);
    }
    const schedule: CronjobSchedule = cronjob;
    const expression = toCronPackageExpression(getCronjobEffectiveExpression(schedule));
    const job = new CronJob(expression, () => {
        void dispatchCronjobRun(cronjob.id).catch((err) => {
            console.error(`Failed to dispatch cronjob ${cronjob.id}:`, err);
        });
    }, null, false, schedule.timezone);
    job.start();
    scheduledJobs.set(cronjob.id, job);
}

export async function rescheduleCronjob(cronjobId: string): Promise<void> {
    const cronjob = await prisma.cronjobs.findUnique({
        where: { id: cronjobId },
        select: {
            id: true,
            enabled: true,
            cron_expression: true,
            timezone: true,
        }
    });
    const existing = scheduledJobs.get(cronjobId);
    if (existing) {
        void existing.stop();
        scheduledJobs.delete(cronjobId);
    }
    if (!cronjob || !cronjob.enabled) return;
    scheduleOneCronjob(cronjob);
}

export async function startUserCronjobScheduler(): Promise<void> {
    const cronjobs = await prisma.cronjobs.findMany({
        where: { enabled: true },
        select: {
            id: true,
            cron_expression: true,
            timezone: true,
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
            status: "running",
        },
    });
    if (!run) {
        throw {
            status: 404,
            message: "No running cronjob found for this session"
        };
    }

    const pendingQuestion = await getPendingQuestionForSession(opencodeSessionId);
    const pendingPermissions = await listPendingPermissionsForSession(opencodeSessionId);
    if (pendingQuestion || pendingPermissions.length > 0) {
        throw {
            status: 409,
            message: "Cronjob cannot be marked complete while the session is waiting for input or permission"
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

import { CronJob, CronTime } from "cron";
import prisma from "../prisma/client";
import { getOpencodeClient } from "../utils/opencode-client";
import { getResourceAccessSummary } from "../utils/resource-access";
import { listSkillSlugs, readSkillManifestAndEnsurePermissions } from "../utils/skill";
import { listResolvedSecretsForUser } from "../utils/secrets";
import {
    getSessionStatusTypeForSession,
    type SessionStatusMap,
} from "../utils/chat-session";
import {
    getPendingQuestionForSession,
    listPendingPermissionsForSession,
} from "../utils/opencode-client";

const CRONJOB_MONITOR_INTERVAL_MS = 5000;

const PRESET_CRON_EXPRESSIONS: Record<string, string> = {
    hourly: "0 * * * *",
    daily: "0 9 * * *",
    weekdays: "0 9 * * 1-5",
    weekly: "0 9 * * 1",
};

type CronjobSchedule = {
    preset_key: string | null;
    cron_expression: string | null;
    timezone: string;
    schedule_type: string;
    time_minutes: number | null;
    days_of_week: string | null;
    week_interval: number | null;
    anchor_date: string | null;
    day_of_month: number | null;
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

function assertIntegerInRange(value: unknown, label: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw {
            status: 400,
            message: `${label} must be an integer between ${min} and ${max}`
        };
    }
    return value;
}

function assertDateString(value: unknown, label: string): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw {
            status: 400,
            message: `${label} must be a YYYY-MM-DD date`
        };
    }
    return value;
}

function parseDaysOfWeek(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw {
            status: 400,
            message: "days_of_week must include at least one day"
        };
    }
    const days = value.map((day) => assertIntegerInRange(day, "days_of_week", 0, 6));
    return Array.from(new Set(days)).sort((a, b) => a - b);
}

export function validateCronjobSchedule(input: {
    preset_key?: unknown;
    cron_expression?: unknown;
    timezone?: unknown;
    schedule_type?: unknown;
    time_minutes?: unknown;
    days_of_week?: unknown;
    week_interval?: unknown;
    anchor_date?: unknown;
    day_of_month?: unknown;
}): {
    presetKey: string | null;
    cronExpression: string | null;
    timezone: string;
    scheduleType: string;
    timeMinutes: number | null;
    daysOfWeek: string | null;
    weekInterval: number | null;
    anchorDate: string | null;
    dayOfMonth: number | null;
} {
    if (typeof input.timezone !== "string" || input.timezone.trim().length === 0) {
        throw {
            status: 400,
            message: "timezone is required"
        };
    }
    const timezone = input.timezone.trim();
    assertTimezone(timezone);

    const scheduleType = typeof input.schedule_type === "string" && input.schedule_type.trim().length > 0
        ? input.schedule_type.trim()
        : "cron";

    if (scheduleType === "structured") {
        const timeMinutes = assertIntegerInRange(input.time_minutes, "time_minutes", 0, 1439);
        const weekInterval = assertIntegerInRange(input.week_interval, "week_interval", 1, 52);
        const anchorDate = assertDateString(input.anchor_date, "anchor_date");
        const dayOfMonth = input.day_of_month === null || input.day_of_month === undefined
            ? null
            : assertIntegerInRange(input.day_of_month, "day_of_month", 1, 31);
        const daysOfWeek = dayOfMonth === null ? parseDaysOfWeek(input.days_of_week).join(",") : null;
        const cronExpression = buildStructuredCronExpression({
            time_minutes: timeMinutes,
            days_of_week: daysOfWeek,
            day_of_month: dayOfMonth,
        });
        assertCronExpression(cronExpression, timezone);
        return {
            presetKey: null,
            cronExpression: null,
            timezone,
            scheduleType,
            timeMinutes,
            daysOfWeek,
            weekInterval,
            anchorDate,
            dayOfMonth,
        };
    }
    if (scheduleType !== "cron") {
        throw {
            status: 400,
            message: "schedule_type must be cron or structured"
        };
    }

    const rawPresetKey = typeof input.preset_key === "string" && input.preset_key.trim().length > 0
        ? input.preset_key.trim()
        : null;
    const rawCronExpression = typeof input.cron_expression === "string" && input.cron_expression.trim().length > 0
        ? input.cron_expression.trim()
        : null;

    if ((rawPresetKey === null && rawCronExpression === null) || (rawPresetKey !== null && rawCronExpression !== null)) {
        throw {
            status: 400,
            message: "Provide exactly one of preset_key or cron_expression"
        };
    }

    if (rawPresetKey !== null) {
        const expression = PRESET_CRON_EXPRESSIONS[rawPresetKey];
        if (!expression) {
            throw {
                status: 400,
                message: `Unsupported preset_key: ${rawPresetKey}`
            };
        }
        assertCronExpression(expression, timezone);
        return {
            presetKey: rawPresetKey,
            cronExpression: null,
            timezone,
            scheduleType,
            timeMinutes: null,
            daysOfWeek: null,
            weekInterval: null,
            anchorDate: null,
            dayOfMonth: null,
        };
    }

    assertCronExpression(rawCronExpression!, timezone);
    return {
        presetKey: null,
        cronExpression: rawCronExpression!,
        timezone,
        scheduleType,
        timeMinutes: null,
        daysOfWeek: null,
        weekInterval: null,
        anchorDate: null,
        dayOfMonth: null,
    };
}

function buildStructuredCronExpression(schedule: {
    time_minutes: number | null;
    days_of_week: string | null;
    day_of_month: number | null;
}): string {
    if (schedule.time_minutes === null) {
        throw new Error("Structured cronjob schedule is missing time_minutes");
    }
    const minute = schedule.time_minutes % 60;
    const hour = Math.floor(schedule.time_minutes / 60);
    if (schedule.day_of_month !== null) {
        return `${minute} ${hour} ${schedule.day_of_month} * *`;
    }
    return `${minute} ${hour} * * ${schedule.days_of_week || "*"}`;
}

export function getCronjobEffectiveExpression(schedule: {
    preset_key: string | null;
    cron_expression: string | null;
    schedule_type?: string;
    time_minutes?: number | null;
    days_of_week?: string | null;
    day_of_month?: number | null;
}): string {
    if (schedule.schedule_type === "structured") {
        return buildStructuredCronExpression({
            time_minutes: schedule.time_minutes ?? null,
            days_of_week: schedule.days_of_week ?? null,
            day_of_month: schedule.day_of_month ?? null,
        });
    }
    if (schedule.preset_key) {
        const expression = PRESET_CRON_EXPRESSIONS[schedule.preset_key];
        if (!expression) {
            throw new Error(`Unsupported preset_key: ${schedule.preset_key}`);
        }
        return expression;
    }
    if (!schedule.cron_expression) {
        throw new Error("Cronjob schedule is missing cron_expression");
    }
    return schedule.cron_expression;
}

function parseLocalDate(date: string): Date {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcWeek(date: Date): Date {
    const day = date.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const result = new Date(date);
    result.setUTCDate(date.getUTCDate() + diffToMonday);
    result.setUTCHours(0, 0, 0, 0);
    return result;
}

function weeksBetween(anchorDate: string, candidateDate: string): number {
    const anchorWeek = startOfUtcWeek(parseLocalDate(anchorDate));
    const candidateWeek = startOfUtcWeek(parseLocalDate(candidateDate));
    return Math.floor((candidateWeek.getTime() - anchorWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function getLocalDateString(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")!.value;
    const month = parts.find((part) => part.type === "month")!.value;
    const day = parts.find((part) => part.type === "day")!.value;
    return `${year}-${month}-${day}`;
}

function isStructuredScheduleDue(schedule: CronjobSchedule, date: Date): boolean {
    if (schedule.schedule_type !== "structured") return true;
    if (schedule.week_interval === null || schedule.week_interval <= 1 || schedule.anchor_date === null) return true;
    if (schedule.day_of_month !== null) return true;
    const localDate = getLocalDateString(date, schedule.timezone);
    const weekOffset = weeksBetween(schedule.anchor_date, localDate);
    return weekOffset >= 0 && weekOffset % schedule.week_interval === 0;
}

export function getNextRunAt(schedule: CronjobSchedule): number {
    const expression = toCronPackageExpression(getCronjobEffectiveExpression(schedule));
    const cronTime = new CronTime(expression, schedule.timezone);
    if (schedule.schedule_type !== "structured" || schedule.week_interval === null || schedule.week_interval <= 1 || schedule.day_of_month !== null) {
        return cronTime.sendAt().toMillis();
    }
    const candidates = cronTime.sendAt(370);
    const nextCandidate = candidates.find((candidate) => isStructuredScheduleDue(schedule, candidate.toJSDate()));
    return (nextCandidate ?? candidates[candidates.length - 1]).toMillis();
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

async function revealRunForUserInput(runId: string, reason: string): Promise<void> {
    const completedAt = nowMs();
    const run = await prisma.cronjob_runs.update({
        where: { id: runId },
        data: {
            status: "needs_user_input",
            completed_at: completedAt,
            needs_user_input_reason: reason,
        },
    });
    if (run.session_id) {
        await prisma.chat_sessions.update({
            where: { id: run.session_id },
            data: {
                visible_to_user: true,
                updated_at: Number(completedAt),
            },
        });
    }
}

async function inferNeedsUserInputReason(opencodeSessionId: string): Promise<string> {
    const pendingQuestion = await getPendingQuestionForSession(opencodeSessionId);
    if (pendingQuestion) {
        return "Cronjob is waiting for a tool answer.";
    }
    const pendingPermissions = await listPendingPermissionsForSession(opencodeSessionId);
    if (pendingPermissions.length > 0) {
        return "Cronjob is waiting for a permission response.";
    }
    return "Cronjob stopped before marking itself complete.";
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

            const reason = await inferNeedsUserInputReason(opencodeSessionId);
            await revealRunForUserInput(runId, reason);
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
                prompt_snapshot: cronjob.prompt,
                error_message: "Previous run is still active.",
            },
        });
        return skipped.id;
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
            prompt_snapshot: cronjob.prompt,
            opencode_session_id: sessionResult.data.id,
        },
    });
    const chatSession = await prisma.chat_sessions.create({
        data: {
            user_id: cronjob.user_id,
            opencode_session_id: sessionResult.data.id,
            title: `Cronjob: ${cronjob.name}`,
            source: "cronjob",
            visible_to_user: false,
            created_at: Number(now),
            updated_at: Number(now),
        },
    });
    await prisma.cronjob_runs.update({
        where: { id: run.id },
        data: { session_id: chatSession.id },
    });

    const prompt = await buildCronjobPrompt({
        cronjobName: cronjob.name,
        cronjobPrompt: cronjob.prompt,
        allowWorkflowRunsWithoutPermission: cronjob.allow_workflow_runs_without_permission,
        userId: cronjob.user_id,
    });
    const promptResult = await client.session.promptAsync({
        path: { id: sessionResult.data.id },
        body: {
            parts: [{ type: "text", text: prompt }],
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
    schedule: CronjobSchedule | null;
}): void {
    const existing = scheduledJobs.get(cronjob.id);
    if (existing) {
        void existing.stop();
        scheduledJobs.delete(cronjob.id);
    }
    if (!cronjob.schedule) return;

    const expression = toCronPackageExpression(getCronjobEffectiveExpression(cronjob.schedule));
    const job = new CronJob(expression, () => {
        if (!isStructuredScheduleDue(cronjob.schedule!, new Date())) return;
        void dispatchCronjobRun(cronjob.id).catch((err) => {
            console.error(`Failed to dispatch cronjob ${cronjob.id}:`, err);
        });
    }, null, false, cronjob.schedule.timezone);
    job.start();
    scheduledJobs.set(cronjob.id, job);
}

export async function rescheduleCronjob(cronjobId: string): Promise<void> {
    const cronjob = await prisma.cronjobs.findUnique({
        where: { id: cronjobId },
        select: {
            id: true,
            enabled: true,
            schedule: {
                select: {
                    preset_key: true,
                    cron_expression: true,
                    timezone: true,
                    schedule_type: true,
                    time_minutes: true,
                    days_of_week: true,
                    week_interval: true,
                    anchor_date: true,
                    day_of_month: true,
                }
            }
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
            schedule: {
                select: {
                    preset_key: true,
                    cron_expression: true,
                    timezone: true,
                    schedule_type: true,
                    time_minutes: true,
                    days_of_week: true,
                    week_interval: true,
                    anchor_date: true,
                    day_of_month: true,
                }
            }
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

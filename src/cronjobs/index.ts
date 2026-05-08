import express from "express";
import prisma from "../prisma/client";
import { apiHandler } from "../utils";
import {
    completeCurrentCronjobRun,
    dispatchCronjobRun,
    getCronjobEffectiveExpression,
    getNextRunAt,
    rescheduleCronjob,
    validateCronjobSchedule,
} from "./scheduler";
import { abortOpencodeSession } from "../utils/session-abort";
import { readWorkflowManifestAndEnsurePermissions } from "../utils/workflow";
import { getResourceAccessSummary } from "../utils/resource-access";
import { resolveSecretsForUser } from "../utils/secrets";
import { validateInputs } from "../utils/workflow-runner";
import { markWorkflowSessionAborted } from "../utils/workflow-interruption";

const router = express.Router({ mergeParams: true });

function nowMs(): bigint {
    return BigInt(Date.now());
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

function hasRequestField(body: unknown, field: string): boolean {
    return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
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

async function validateCronjobTarget(input: {
    target_type?: unknown;
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
    const targetType = typeof input.target_type === "string" && input.target_type.trim().length > 0
        ? input.target_type.trim()
        : "prompt";

    if (targetType === "prompt") {
        return {
            targetType,
            prompt: assertNonEmptyString(input.prompt, "prompt"),
            promptAllowWorkflowRunsWithoutPermission: input.allow_workflow_runs_without_permission !== false,
            workflowSlug: null,
            workflowInputJson: null,
        };
    }

    if (targetType !== "workflow") {
        throw {
            status: 400,
            message: "target_type must be prompt or workflow"
        };
    }

    const workflowSlug = assertNonEmptyString(input.workflow_slug, "workflow_slug");
    const workflowInputs = input.workflow_inputs === undefined ? {} : assertObject(input.workflow_inputs, "workflow_inputs");
    const { manifest } = await readWorkflowManifestAndEnsurePermissions(workflowSlug);
    const accessSummary = await getResourceAccessSummary("workflow", workflowSlug, userId);
    if (!accessSummary.is_approved) {
        throw {
            status: 403,
            message: "Workflow must be approved before it can be scheduled"
        };
    }
    if (!accessSummary.can_edit) {
        throw {
            status: 403,
            message: accessSummary.is_locked_due_to_missing_users
                ? "Workflow cannot be scheduled because no allowed users remain"
                : "You do not have permission to schedule this workflow"
        };
    }
    const secretResolution = await resolveSecretsForUser(userId, manifest.required_secrets ?? []);
    if (secretResolution.missingKeys.length > 0) {
        throw {
            status: 400,
            message: `Missing required secrets for workflow: ${secretResolution.missingKeys.join(", ")}`
        };
    }
    const validation = validateInputs(workflowInputs, manifest.inputs ?? {});
    if (!validation.valid) {
        throw {
            status: 400,
            message: `Workflow input validation failed: ${validation.errors.join("; ")}`
        };
    }
    return {
        targetType,
        prompt: null,
        promptAllowWorkflowRunsWithoutPermission: null,
        workflowSlug,
        workflowInputJson: JSON.stringify(validation.processedInputs),
    };
}

function serializeCronjob(cronjob: {
    id: string;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    created_at: bigint;
    updated_at: bigint;
    schedule: {
        preset_key: string | null;
        cron_expression: string | null;
        timezone: string;
        schedule_type: string;
        time_minutes: number | null;
        days_of_week: string | null;
        week_interval: number | null;
        anchor_date: string | null;
        day_of_month: number | null;
    } | null;
    target?: {
        target_type: string;
        prompt: string | null;
        prompt_allow_workflow_runs_without_permission: boolean | null;
        workflow_slug: string | null;
        workflow_input_json: string | null;
    } | null;
    is_running?: boolean;
    current_run_id?: string | null;
    runs?: Array<{
        id: string;
        status: string;
        started_at: bigint;
        completed_at: bigint | null;
    }>;
}) {
    const schedule = cronjob.schedule;
    const target = cronjob.target ?? {
        target_type: "prompt",
        prompt: cronjob.prompt,
        prompt_allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
        workflow_slug: null,
        workflow_input_json: null,
    };
    return {
        id: cronjob.id,
        name: cronjob.name,
        prompt: target.prompt ?? "",
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: target.prompt_allow_workflow_runs_without_permission ?? true,
        target: {
            target_type: target.target_type,
            prompt: target.prompt,
            prompt_allow_workflow_runs_without_permission: target.prompt_allow_workflow_runs_without_permission,
            workflow_slug: target.workflow_slug,
            workflow_inputs: target.workflow_input_json ? JSON.parse(target.workflow_input_json) : null,
        },
        created_at: cronjob.created_at,
        updated_at: cronjob.updated_at,
        schedule: schedule ? {
            preset_key: schedule.preset_key,
            cron_expression: schedule.cron_expression,
            timezone: schedule.timezone,
            schedule_type: schedule.schedule_type,
            time_minutes: schedule.time_minutes,
            days_of_week: schedule.days_of_week ? schedule.days_of_week.split(",").map(Number) : null,
            week_interval: schedule.week_interval,
            anchor_date: schedule.anchor_date,
            day_of_month: schedule.day_of_month,
            effective_cron_expression: getCronjobEffectiveExpression(schedule),
        } : null,
        next_run_at: cronjob.enabled && schedule ? getNextRunAt(schedule) : null,
        is_running: cronjob.is_running === true,
        current_run_id: cronjob.current_run_id ?? null,
        latest_run: cronjob.runs?.[0] ?? null,
    };
}

function serializeRun(run: {
    id: string;
    cronjob_id: string;
    status: string;
    started_at: bigint;
    completed_at: bigint | null;
    target_type_snapshot: string;
    prompt_snapshot: string | null;
    workflow_slug_snapshot: string | null;
    workflow_input_snapshot_json: string | null;
    workflow_run_id: string | null;
    summary: string | null;
    session_id: string | null;
    opencode_session_id: string | null;
    needs_user_input_reason: string | null;
    error_message: string | null;
}) {
    return {
        id: run.id,
        cronjob_id: run.cronjob_id,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at,
        target_type_snapshot: run.target_type_snapshot,
        prompt_snapshot: run.prompt_snapshot,
        workflow_slug_snapshot: run.workflow_slug_snapshot,
        workflow_input_snapshot: run.workflow_input_snapshot_json ? JSON.parse(run.workflow_input_snapshot_json) : null,
        workflow_run_id: run.workflow_run_id,
        summary: run.summary,
        session_id: run.session_id,
        opencode_session_id: run.opencode_session_id,
        needs_user_input_reason: run.needs_user_input_reason,
        error_message: run.error_message,
    };
}

router.get("/", apiHandler(async (req, res) => {
    const cronjobs = await prisma.cronjobs.findMany({
        where: { user_id: req.userId! },
        orderBy: { updated_at: "desc" },
        include: {
            schedule: true,
            target: true,
            runs: {
                orderBy: { started_at: "desc" },
                take: 1,
                select: {
                    id: true,
                    status: true,
                    started_at: true,
                    completed_at: true,
                    target_type_snapshot: true,
                    workflow_run_id: true,
                },
            },
        },
    });
    const activeRuns = await prisma.cronjob_runs.findMany({
        where: {
            cronjob_id: { in: cronjobs.map((cronjob) => cronjob.id) },
            status: "running",
        },
        select: { id: true, cronjob_id: true },
    });
    const activeCronjobIds = new Set(activeRuns.map((run) => run.cronjob_id));
    const activeRunIdByCronjobId = new Map(activeRuns.map((run) => [run.cronjob_id, run.id]));
    res.json({ cronjobs: cronjobs.map((cronjob) => serializeCronjob({
        ...cronjob,
        is_running: activeCronjobIds.has(cronjob.id),
        current_run_id: activeRunIdByCronjobId.get(cronjob.id) ?? null,
    })) });
}, true));

router.post("/", apiHandler(async (req, res) => {
    const name = assertNonEmptyString(req.body?.name, "name");
    const target = await validateCronjobTarget({
        target_type: req.body?.target_type,
        prompt: req.body?.prompt,
        allow_workflow_runs_without_permission: req.body?.allow_workflow_runs_without_permission,
        workflow_slug: req.body?.workflow_slug,
        workflow_inputs: req.body?.workflow_inputs,
    }, req.userId!);
    const schedule = validateCronjobSchedule({
        preset_key: req.body?.preset_key,
        cron_expression: req.body?.cron_expression,
        timezone: req.body?.timezone,
        schedule_type: req.body?.schedule_type,
        time_minutes: req.body?.time_minutes,
        days_of_week: req.body?.days_of_week,
        week_interval: req.body?.week_interval,
        anchor_date: req.body?.anchor_date,
        day_of_month: req.body?.day_of_month,
    });
    const now = nowMs();
    const enabled = req.body?.enabled !== false;

    const cronjob = await prisma.cronjobs.create({
        data: {
            user_id: req.userId!,
            name,
            prompt: target.prompt ?? "",
            enabled,
            allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission ?? true,
            created_at: now,
            updated_at: now,
            target: {
                create: {
                    target_type: target.targetType,
                    prompt: target.prompt,
                    prompt_allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission,
                    workflow_slug: target.workflowSlug,
                    workflow_input_json: target.workflowInputJson,
                    created_at: now,
                    updated_at: now,
                },
            },
            schedule: {
                create: {
                    preset_key: schedule.presetKey,
                    cron_expression: schedule.cronExpression,
                    timezone: schedule.timezone,
                    schedule_type: schedule.scheduleType,
                    time_minutes: schedule.timeMinutes,
                    days_of_week: schedule.daysOfWeek,
                    week_interval: schedule.weekInterval,
                    anchor_date: schedule.anchorDate,
                    day_of_month: schedule.dayOfMonth,
                    created_at: now,
                    updated_at: now,
                },
            },
        },
        include: { schedule: true, target: true },
    });
    await rescheduleCronjob(cronjob.id);
    const activeRun = await prisma.cronjob_runs.findFirst({
        where: { cronjob_id: cronjob.id, status: "running" },
        select: { id: true },
    });
    res.json({ cronjob: serializeCronjob({ ...cronjob, is_running: activeRun !== null }) });
}, true));

router.get("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        include: {
            schedule: true,
            target: true,
            runs: {
                orderBy: { started_at: "desc" },
                take: 1,
                select: {
                    id: true,
                    status: true,
                    started_at: true,
                    completed_at: true,
                },
            },
        },
    });
    if (!cronjob) {
        throw { status: 404, message: "Cronjob not found" };
    }
    const activeRun = await prisma.cronjob_runs.findFirst({
        where: { cronjob_id: cronjob.id, status: "running" },
        select: { id: true },
    });
    res.json({ cronjob: serializeCronjob({ ...cronjob, is_running: activeRun !== null }) });
}, true));

router.patch("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        include: { schedule: true, target: true },
    });
    if (!existing) {
        throw { status: 404, message: "Cronjob not found" };
    }

    const name = req.body?.name === undefined ? existing.name : assertNonEmptyString(req.body.name, "name");
    const enabled = req.body?.enabled === undefined ? existing.enabled : Boolean(req.body.enabled);
    const existingTarget = existing.target ?? {
        target_type: "prompt",
        prompt: existing.prompt,
        prompt_allow_workflow_runs_without_permission: existing.allow_workflow_runs_without_permission,
        workflow_slug: null,
        workflow_input_json: null,
    };
    const target = await validateCronjobTarget({
        target_type: hasRequestField(req.body, "target_type") ? req.body.target_type : existingTarget.target_type,
        prompt: hasRequestField(req.body, "prompt") ? req.body.prompt : existingTarget.prompt,
        allow_workflow_runs_without_permission: hasRequestField(req.body, "allow_workflow_runs_without_permission")
            ? req.body.allow_workflow_runs_without_permission
            : existingTarget.prompt_allow_workflow_runs_without_permission ?? undefined,
        workflow_slug: hasRequestField(req.body, "workflow_slug") ? req.body.workflow_slug : existingTarget.workflow_slug ?? undefined,
        workflow_inputs: hasRequestField(req.body, "workflow_inputs")
            ? req.body.workflow_inputs
            : existingTarget.workflow_input_json
                ? JSON.parse(existingTarget.workflow_input_json)
                : undefined,
    }, req.userId!);
    const schedule = validateCronjobSchedule({
        preset_key: hasRequestField(req.body, "preset_key") ? req.body.preset_key : existing.schedule?.preset_key ?? undefined,
        cron_expression: hasRequestField(req.body, "cron_expression") ? req.body.cron_expression : existing.schedule?.cron_expression ?? undefined,
        timezone: hasRequestField(req.body, "timezone") ? req.body.timezone : existing.schedule?.timezone ?? undefined,
        schedule_type: hasRequestField(req.body, "schedule_type") ? req.body.schedule_type : existing.schedule?.schedule_type ?? undefined,
        time_minutes: hasRequestField(req.body, "time_minutes") ? req.body.time_minutes : existing.schedule?.time_minutes ?? undefined,
        days_of_week: hasRequestField(req.body, "days_of_week") ? req.body.days_of_week : existing.schedule?.days_of_week?.split(",").map(Number) ?? undefined,
        week_interval: hasRequestField(req.body, "week_interval") ? req.body.week_interval : existing.schedule?.week_interval ?? undefined,
        anchor_date: hasRequestField(req.body, "anchor_date") ? req.body.anchor_date : existing.schedule?.anchor_date ?? undefined,
        day_of_month: hasRequestField(req.body, "day_of_month") ? req.body.day_of_month : existing.schedule?.day_of_month ?? undefined,
    });
    const now = nowMs();

    const cronjob = await prisma.cronjobs.update({
        where: { id },
        data: {
            name,
            prompt: target.prompt ?? "",
            enabled,
            allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission ?? true,
            updated_at: now,
            target: {
                upsert: {
                    create: {
                        target_type: target.targetType,
                        prompt: target.prompt,
                        prompt_allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission,
                        workflow_slug: target.workflowSlug,
                        workflow_input_json: target.workflowInputJson,
                        created_at: now,
                        updated_at: now,
                    },
                    update: {
                        target_type: target.targetType,
                        prompt: target.prompt,
                        prompt_allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission,
                        workflow_slug: target.workflowSlug,
                        workflow_input_json: target.workflowInputJson,
                        updated_at: now,
                    },
                },
            },
            schedule: {
                upsert: {
                    create: {
                        preset_key: schedule.presetKey,
                        cron_expression: schedule.cronExpression,
                        timezone: schedule.timezone,
                        schedule_type: schedule.scheduleType,
                        time_minutes: schedule.timeMinutes,
                        days_of_week: schedule.daysOfWeek,
                        week_interval: schedule.weekInterval,
                        anchor_date: schedule.anchorDate,
                        day_of_month: schedule.dayOfMonth,
                        created_at: now,
                        updated_at: now,
                    },
                    update: {
                        preset_key: schedule.presetKey,
                        cron_expression: schedule.cronExpression,
                        timezone: schedule.timezone,
                        schedule_type: schedule.scheduleType,
                        time_minutes: schedule.timeMinutes,
                        days_of_week: schedule.daysOfWeek,
                        week_interval: schedule.weekInterval,
                        anchor_date: schedule.anchorDate,
                        day_of_month: schedule.dayOfMonth,
                        updated_at: now,
                    },
                },
            },
        },
        include: { schedule: true, target: true },
    });
    await rescheduleCronjob(cronjob.id);
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.delete("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true }
    });
    if (!cronjob) {
        throw { status: 404, message: "Cronjob not found" };
    }
    await prisma.cronjobs.delete({ where: { id } });
    await rescheduleCronjob(id);
    res.json({ success: true });
}, true));

router.post("/:id/enable", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true },
    });
    if (!existing) {
        throw { status: 404, message: "Cronjob not found" };
    }
    const cronjob = await prisma.cronjobs.update({
        where: { id },
        data: { enabled: true, updated_at: nowMs() },
        include: { schedule: true, target: true },
    });
    await rescheduleCronjob(id);
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.post("/:id/disable", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true },
    });
    if (!existing) {
        throw { status: 404, message: "Cronjob not found" };
    }
    const cronjob = await prisma.cronjobs.update({
        where: { id },
        data: { enabled: false, updated_at: nowMs() },
        include: { schedule: true, target: true },
    });
    await rescheduleCronjob(id);
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.get("/:id/runs", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true },
    });
    if (!cronjob) {
        throw { status: 404, message: "Cronjob not found" };
    }
    const runs = await prisma.cronjob_runs.findMany({
        where: { cronjob_id: id },
        orderBy: { started_at: "desc" },
        take: 50,
    });
    res.json({ runs: runs.map(serializeRun) });
}, true));

router.post("/:id/run-now", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true },
    });
    if (!cronjob) {
        throw { status: 404, message: "Cronjob not found" };
    }
    const runId = await dispatchCronjobRun(id, { allowDisabled: true, skipIfActive: false });
    const run = await prisma.cronjob_runs.findUnique({
        where: { id: runId },
        select: { workflow_run_id: true },
    });
    res.json({ run_id: runId, workflow_run_id: run?.workflow_run_id ?? null });
}, true));

router.get("/runs/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            id,
            cronjob: { user_id: req.userId! },
        },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    res.json({ run: serializeRun(run) });
}, true));

router.post("/runs/:id/stop", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            id,
            cronjob: { user_id: req.userId! },
        },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    if (run.status !== "running") {
        res.json({ success: true });
        return;
    }
    if (run.opencode_session_id) {
        await abortOpencodeSession(run.opencode_session_id);
    }
    if (run.workflow_run_id) {
        const workflowRun = await prisma.workflow_runs.findUnique({
            where: { id: run.workflow_run_id },
            select: { session_id: true },
        });
        if (workflowRun?.session_id) {
            await markWorkflowSessionAborted(workflowRun.session_id);
        }
    }
    await prisma.cronjob_runs.update({
        where: { id },
        data: {
            status: "failed",
            completed_at: nowMs(),
            error_message: "Cronjob run was stopped by the user.",
        },
    });
    res.json({ success: true });
}, true));

router.post("/runs/complete-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const summary = assertNonEmptyString(req.body?.summary, "summary");
    await completeCurrentCronjobRun(req.opencode_session_id, summary);
    res.json({ success: true });
}, true));

export default router;

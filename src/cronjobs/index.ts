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
    } | null;
    runs?: Array<{
        id: string;
        status: string;
        started_at: bigint;
        completed_at: bigint | null;
    }>;
}) {
    const schedule = cronjob.schedule;
    return {
        id: cronjob.id,
        name: cronjob.name,
        prompt: cronjob.prompt,
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
        created_at: cronjob.created_at,
        updated_at: cronjob.updated_at,
        schedule: schedule ? {
            preset_key: schedule.preset_key,
            cron_expression: schedule.cron_expression,
            timezone: schedule.timezone,
            effective_cron_expression: getCronjobEffectiveExpression(schedule),
        } : null,
        next_run_at: cronjob.enabled && schedule ? getNextRunAt(schedule) : null,
        latest_run: cronjob.runs?.[0] ?? null,
    };
}

function serializeRun(run: {
    id: string;
    cronjob_id: string;
    status: string;
    started_at: bigint;
    completed_at: bigint | null;
    prompt_snapshot: string;
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
        prompt_snapshot: run.prompt_snapshot,
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
    res.json({ cronjobs: cronjobs.map(serializeCronjob) });
}, true));

router.post("/", apiHandler(async (req, res) => {
    const name = assertNonEmptyString(req.body?.name, "name");
    const prompt = assertNonEmptyString(req.body?.prompt, "prompt");
    const schedule = validateCronjobSchedule({
        preset_key: req.body?.preset_key,
        cron_expression: req.body?.cron_expression,
        timezone: req.body?.timezone,
    });
    const now = nowMs();
    const allowWorkflowRunsWithoutPermission = req.body?.allow_workflow_runs_without_permission !== false;
    const enabled = req.body?.enabled !== false;

    const cronjob = await prisma.cronjobs.create({
        data: {
            user_id: req.userId!,
            name,
            prompt,
            enabled,
            allow_workflow_runs_without_permission: allowWorkflowRunsWithoutPermission,
            created_at: now,
            updated_at: now,
            schedule: {
                create: {
                    preset_key: schedule.presetKey,
                    cron_expression: schedule.cronExpression,
                    timezone: schedule.timezone,
                    created_at: now,
                    updated_at: now,
                },
            },
        },
        include: { schedule: true },
    });
    await rescheduleCronjob(cronjob.id);
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.get("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        include: {
            schedule: true,
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
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.patch("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        include: { schedule: true },
    });
    if (!existing) {
        throw { status: 404, message: "Cronjob not found" };
    }

    const name = req.body?.name === undefined ? existing.name : assertNonEmptyString(req.body.name, "name");
    const prompt = req.body?.prompt === undefined ? existing.prompt : assertNonEmptyString(req.body.prompt, "prompt");
    const enabled = req.body?.enabled === undefined ? existing.enabled : Boolean(req.body.enabled);
    const allowWorkflowRunsWithoutPermission = req.body?.allow_workflow_runs_without_permission === undefined
        ? existing.allow_workflow_runs_without_permission
        : Boolean(req.body.allow_workflow_runs_without_permission);
    const schedule = validateCronjobSchedule({
        preset_key: hasRequestField(req.body, "preset_key") ? req.body.preset_key : existing.schedule?.preset_key ?? undefined,
        cron_expression: hasRequestField(req.body, "cron_expression") ? req.body.cron_expression : existing.schedule?.cron_expression ?? undefined,
        timezone: hasRequestField(req.body, "timezone") ? req.body.timezone : existing.schedule?.timezone ?? undefined,
    });
    const now = nowMs();

    const cronjob = await prisma.cronjobs.update({
        where: { id },
        data: {
            name,
            prompt,
            enabled,
            allow_workflow_runs_without_permission: allowWorkflowRunsWithoutPermission,
            updated_at: now,
            schedule: {
                upsert: {
                    create: {
                        preset_key: schedule.presetKey,
                        cron_expression: schedule.cronExpression,
                        timezone: schedule.timezone,
                        created_at: now,
                        updated_at: now,
                    },
                    update: {
                        preset_key: schedule.presetKey,
                        cron_expression: schedule.cronExpression,
                        timezone: schedule.timezone,
                        updated_at: now,
                    },
                },
            },
        },
        include: { schedule: true },
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
        include: { schedule: true },
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
        include: { schedule: true },
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
    const runId = await dispatchCronjobRun(id, { allowDisabled: true });
    res.json({ run_id: runId });
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

import express from "express";
import prisma from "../prisma/client";
import { apiHandler } from "../utils";
import {
    completeCurrentCronjobRun,
    dispatchCronjobRun,
    getNextRunAt,
    scheduleOneCronjob,
    validateCronjobTarget,
    validateCronjobSchedule,
} from "./scheduler";
import { abortOpencodeSession } from "../utils/session-abort";
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

function assertBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
        throw {
            status: 400,
            message: `${label} must be a boolean`
        };
    }
    return value;
}

function hasRequestField(body: unknown, field: string): boolean {
    return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

function serializeCronjob(cronjob: {
    id: string;
    name: string;
    enabled: boolean;
    target_type: string;
    prompt: string | null;
    prompt_allow_workflow_runs_without_permission: boolean | null;
    workflow_slug: string | null;
    workflow_input_json: string | null;
    cron_expression: string;
    timezone: string;
    created_at: bigint;
    updated_at: bigint;
    is_running?: boolean;
    current_run_id?: string | null;
    runs?: Array<{
        id: string;
        status: string;
        started_at: bigint;
        completed_at: bigint | null;
        workflow_run_id?: string | null;
    }>;
}) {
    const schedule = {
        cron_expression: cronjob.cron_expression,
        timezone: cronjob.timezone,
    };
    return {
        id: cronjob.id,
        name: cronjob.name,
        prompt: cronjob.prompt ?? "",
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: cronjob.prompt_allow_workflow_runs_without_permission ?? true,
        target: {
            target_type: cronjob.target_type,
            prompt: cronjob.prompt,
            prompt_allow_workflow_runs_without_permission: cronjob.prompt_allow_workflow_runs_without_permission,
            workflow_slug: cronjob.workflow_slug,
            workflow_inputs: cronjob.workflow_input_json ? JSON.parse(cronjob.workflow_input_json) : null,
        },
        created_at: cronjob.created_at,
        updated_at: cronjob.updated_at,
        schedule: {
            cron_expression: schedule.cron_expression,
            timezone: schedule.timezone,
            effective_cron_expression: schedule.cron_expression,
        },
        next_run_at: cronjob.enabled ? getNextRunAt(schedule) : null,
        is_running: cronjob.is_running === true,
        current_run_id: cronjob.current_run_id ?? null,
        latest_run: cronjob.runs?.[0]
            ? {
                ...cronjob.runs[0],
                target_type_snapshot: cronjob.runs[0].workflow_run_id ? "workflow" : cronjob.target_type,
            }
            : null,
    };
}

function serializeRun(run: {
    id: string;
    cronjob_id: string;
    status: string;
    started_at: bigint;
    completed_at: bigint | null;
    workflow_run_id: string | null;
    summary: string | null;
    session_id: string | null;
    opencode_session_id: string | null;
    error_message: string | null;
    session?: { visible_to_user: boolean } | null;
    workflowRun?: { workflow_slug: string; args: string | null } | null;
    cronjob?: {
        target_type: string;
        prompt: string | null;
        workflow_slug: string | null;
        workflow_input_json: string | null;
    } | null;
}) {
    const targetType = run.workflow_run_id ? "workflow" : run.cronjob?.target_type ?? "prompt";
    const workflowInputJson = run.workflowRun?.args ?? run.cronjob?.workflow_input_json ?? null;
    return {
        id: run.id,
        cronjob_id: run.cronjob_id,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at,
        target_type_snapshot: targetType,
        prompt_snapshot: targetType === "prompt" ? run.cronjob?.prompt ?? null : null,
        workflow_slug_snapshot: run.workflowRun?.workflow_slug ?? run.cronjob?.workflow_slug ?? null,
        workflow_input_snapshot: workflowInputJson ? JSON.parse(workflowInputJson) : null,
        workflow_run_id: run.workflow_run_id,
        summary: run.summary,
        session_id: run.session_id,
        opencode_session_id: run.opencode_session_id,
        needs_user_input_reason: run.status === "running" && run.session?.visible_to_user
            ? "Cronjob stopped before marking itself complete."
            : null,
        error_message: run.error_message,
    };
}

router.get("/", apiHandler(async (req, res) => {
    const cronjobs = await prisma.cronjobs.findMany({
        where: { user_id: req.userId! },
        orderBy: { updated_at: "desc" },
        include: {
            runs: {
                orderBy: { started_at: "desc" },
                take: 1,
                select: {
                    id: true,
                    status: true,
                    started_at: true,
                    completed_at: true,
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
        cron_expression: req.body?.cron_expression,
        timezone: req.body?.timezone,
    });
    const now = nowMs();
    const enabled = assertBoolean(req.body?.enabled, "enabled");

    const cronjob = await prisma.cronjobs.create({
        data: {
            user_id: req.userId!,
            name,
            enabled,
            target_type: target.targetType,
            prompt: target.prompt,
            prompt_allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission,
            workflow_slug: target.workflowSlug,
            workflow_input_json: target.workflowInputJson,
            cron_expression: schedule.cronExpression,
            timezone: schedule.timezone,
            created_at: now,
            updated_at: now,
        },
    });
    scheduleOneCronjob(cronjob);
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
            runs: {
                orderBy: { started_at: "desc" },
                take: 1,
                select: {
                    id: true,
                    status: true,
                    started_at: true,
                    completed_at: true,
                    workflow_run_id: true,
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
    });
    if (!existing) {
        throw { status: 404, message: "Cronjob not found" };
    }

    const name = req.body?.name === undefined ? existing.name : assertNonEmptyString(req.body.name, "name");
    const enabled = req.body?.enabled === undefined ? existing.enabled : assertBoolean(req.body.enabled, "enabled");
    const existingTarget = {
        target_type: existing.target_type,
        prompt: existing.prompt,
        prompt_allow_workflow_runs_without_permission: existing.prompt_allow_workflow_runs_without_permission,
        workflow_slug: existing.workflow_slug,
        workflow_input_json: existing.workflow_input_json,
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
        cron_expression: hasRequestField(req.body, "cron_expression") ? req.body.cron_expression : existing.cron_expression,
        timezone: hasRequestField(req.body, "timezone") ? req.body.timezone : existing.timezone,
    });
    const now = nowMs();

    const cronjob = await prisma.cronjobs.update({
        where: { id },
        data: {
            name,
            enabled,
            target_type: target.targetType,
            prompt: target.prompt,
            prompt_allow_workflow_runs_without_permission: target.promptAllowWorkflowRunsWithoutPermission,
            workflow_slug: target.workflowSlug,
            workflow_input_json: target.workflowInputJson,
            cron_expression: schedule.cronExpression,
            timezone: schedule.timezone,
            updated_at: now,
        },
    });
    scheduleOneCronjob(cronjob);
    res.json({ cronjob: serializeCronjob(cronjob) });
}, true));

router.delete("/:id", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const cronjob = await prisma.cronjobs.findFirst({
        where: { id, user_id: req.userId! },
        select: { id: true, cron_expression: true, timezone: true, enabled: true }
    });
    if (!cronjob) {
        throw { status: 404, message: "Cronjob not found" };
    }
    scheduleOneCronjob({ ...cronjob, enabled: false });
    await prisma.cronjobs.delete({ where: { id } });
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
    });
    scheduleOneCronjob(cronjob);
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
    });
    scheduleOneCronjob(cronjob);
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
        include: {
            session: { select: { visible_to_user: true } },
            workflowRun: { select: { workflow_slug: true, args: true } },
            cronjob: { select: { target_type: true, prompt: true, workflow_slug: true, workflow_input_json: true } },
        },
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
    const runId = await dispatchCronjobRun(id, "manual");
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
        include: {
            session: { select: { visible_to_user: true } },
            workflowRun: { select: { workflow_slug: true, args: true } },
            cronjob: { select: { target_type: true, prompt: true, workflow_slug: true, workflow_input_json: true } },
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

router.post("/runs/fail-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const summary = assertNonEmptyString(req.body?.summary, "summary");
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            opencode_session_id: req.opencode_session_id,
        },
    });
    if (!run) {
        throw {
            status: 404,
            message: "This is not a cronjob session. If this was called via the markCronjobFailed tool, then do not use this tool again."
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
            status: "failed",
            completed_at: nowMs(),
            summary,
            error_message: summary,
        },
    });
    res.json({ success: true });
}, true));

export default router;

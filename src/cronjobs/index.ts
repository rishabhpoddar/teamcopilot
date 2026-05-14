import express from "express";
import prisma from "../prisma/client";
import { Prisma } from "../../prisma/generated/client";
import { apiHandler } from "../utils";
import {
    completeCurrentCronjobRun,
    dispatchCronjobRun,
    getNextRunAt,
    interruptCronjobRun,
    resumeCronjobRun,
    scheduleOneCronjob,
    terminateCronjobRun,
    validateCronjobTarget,
    validateCronjobSchedule,
} from "./scheduler";

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

function assertStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) {
        throw {
            status: 400,
            message: `${label} must be an array of non-empty strings`
        };
    }
    const items = value.map((item) => assertNonEmptyString(item, label));
    if (items.length === 0) {
        throw {
            status: 400,
            message: `${label} must contain at least one item`
        };
    }
    return items;
}

function assertOptionalInsertIndex(value: unknown): number | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw {
            status: 400,
            message: "index must be a non-negative integer"
        };
    }
    return value;
}

function hasRequestField(body: unknown, field: string): boolean {
    return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

function throwCronjobNameConflictIfNeeded(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw {
            status: 409,
            message: "A cronjob with this name already exists."
        };
    }
    throw err;
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
    current_workflow_run_id?: string | null;
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
        current_workflow_run_id: cronjob.current_workflow_run_id ?? null,
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
        error_message: run.error_message,
    };
}

async function getPromptCronjobRun(opencodeSessionId: string) {
    const runs = await prisma.cronjob_runs.findMany({
        where: {
            opencode_session_id: opencodeSessionId,
            cronjob: { target_type: "prompt" },
        },
        select: { id: true, status: true, session_id: true },
    });
    if (runs.length === 0) {
        throw {
            status: 404,
            message: "This is not a prompt cronjob session."
        };
    }
    if (runs.length > 1) {
        throw {
            status: 500,
            message: "Invariant violation: multiple prompt cronjob runs share one OpenCode session."
        };
    }
    return runs[0];
}

function assertActivePromptCronjobRun(run: { status: string }): void {
    if (run.status === "running" || run.status === "paused") return;
    throw {
        status: 400,
        message: `Cronjob session is already finished. Current state is: ${run.status}`
    };
}

router.post("/runs/ask-user-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const message = assertNonEmptyString(req.body?.message, "message");
    const run = await getPromptCronjobRun(req.opencode_session_id);
    assertActivePromptCronjobRun(run);
    if (!run.session_id) {
        throw {
            status: 400,
            message: "Cronjob run does not have an AI chat session."
        };
    }

    const now = Number(nowMs());
    if (run.status === "running") {
        await prisma.$transaction([
            prisma.chat_sessions.update({
                where: { id: run.session_id },
                data: {
                    visible_to_user: true,
                    updated_at: now,
                },
            }),
            prisma.cronjob_runs.update({
                where: { id: run.id },
                data: { status: "paused" },
            }),
        ]);
    } else {
        await prisma.chat_sessions.update({
            where: { id: run.session_id },
            data: {
                visible_to_user: true,
                updated_at: now,
            },
        });
    }

    res.json({ success: true, message });
}, true));

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
            status: { in: ["running", "paused"] },
        },
        select: { id: true, cronjob_id: true, workflow_run_id: true },
    });
    const activeCronjobIds = new Set(activeRuns.map((run) => run.cronjob_id));
    const activeRunIdByCronjobId = new Map(activeRuns.map((run) => [run.cronjob_id, run.id]));
    const activeWorkflowRunIdByCronjobId = new Map(activeRuns.map((run) => [run.cronjob_id, run.workflow_run_id]));
    res.json({ cronjobs: cronjobs.map((cronjob) => serializeCronjob({
        ...cronjob,
        is_running: activeCronjobIds.has(cronjob.id),
        current_run_id: activeRunIdByCronjobId.get(cronjob.id) ?? null,
        current_workflow_run_id: activeWorkflowRunIdByCronjobId.get(cronjob.id) ?? null,
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
    }).catch(throwCronjobNameConflictIfNeeded);
    scheduleOneCronjob(cronjob);
    const activeRun = await prisma.cronjob_runs.findFirst({
        where: { cronjob_id: cronjob.id, status: { in: ["running", "paused"] } },
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
        where: { cronjob_id: cronjob.id, status: { in: ["running", "paused"] } },
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
    }).catch(throwCronjobNameConflictIfNeeded);
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
    const activeRun = await prisma.cronjob_runs.findFirst({
        where: {
            cronjob_id: id,
            status: { in: ["running", "paused"] },
        },
        select: { id: true },
    });
    if (activeRun) {
        throw {
            status: 409,
            message: "Cronjob currently has an active run. Terminate the active run before deleting it."
        };
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
            workflowRun: { select: { workflow_slug: true, args: true } },
            cronjob: { select: { target_type: true, prompt: true, workflow_slug: true, workflow_input_json: true } },
        },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    res.json({ run: serializeRun(run) });
}, true));

router.post("/runs/:id/interrupt", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            id,
            cronjob: { user_id: req.userId! },
        },
        select: { id: true },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    await interruptCronjobRun(run.id);
    res.json({ success: true });
}, true));

router.post("/runs/:id/resume", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            id,
            cronjob: { user_id: req.userId! },
        },
        select: { id: true },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    await resumeCronjobRun(run.id);
    res.json({ success: true });
}, true));

router.post("/runs/:id/terminate", apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.cronjob_runs.findFirst({
        where: {
            id,
            cronjob: { user_id: req.userId! },
        },
        select: { id: true },
    });
    if (!run) {
        throw { status: 404, message: "Cronjob run not found" };
    }
    await terminateCronjobRun(run.id);
    res.json({ success: true });
}, true));

router.post("/runs/todos/set-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const items = assertStringArray(req.body?.items, "items");
    const run = await getPromptCronjobRun(req.opencode_session_id);
    assertActivePromptCronjobRun(run);
    const existingTodo = await prisma.cronjob_run_todos.findFirst({
        where: { run_id: run.id },
        select: { id: true },
    });
    if (existingTodo) {
        throw {
            status: 400,
            message: "Cronjob todo list already exists. Use addCronjobTodos to add more items."
        };
    }
    const now = nowMs();
    await prisma.cronjob_run_todos.createMany({
        data: items.map((content, index) => ({
            run_id: run.id,
            content,
            status: "pending",
            position: index,
            created_at: now,
        })),
    });
    res.json({ success: true, todo_count: items.length });
}, true));

router.post("/runs/todos/add-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const items = assertStringArray(req.body?.items, "items");
    const index = assertOptionalInsertIndex(req.body?.index);
    const run = await getPromptCronjobRun(req.opencode_session_id);
    assertActivePromptCronjobRun(run);
    const now = nowMs();

    await prisma.$transaction(async (tx) => {
        const existingTodos = await tx.cronjob_run_todos.findMany({
            where: { run_id: run.id },
            orderBy: { position: "asc" },
            select: { id: true, status: true },
        });
        const pendingTodos = existingTodos.filter((todo) => todo.status === "pending");
        let insertAt = existingTodos.length;
        if (index !== null) {
            const boundedIndex = Math.min(index, pendingTodos.length);
            const beforePendingTodo = pendingTodos[boundedIndex];
            insertAt = beforePendingTodo
                ? existingTodos.findIndex((todo) => todo.id === beforePendingTodo.id)
                : existingTodos.length;
        }

        const beforeTodos = existingTodos.slice(0, insertAt);
        const afterTodos = existingTodos.slice(insertAt);
        await Promise.all(beforeTodos.map((todo, position) => (
            tx.cronjob_run_todos.update({
                where: { id: todo.id },
                data: { position },
            })
        )));
        await tx.cronjob_run_todos.createMany({
            data: items.map((content, offset) => ({
                run_id: run.id,
                content,
                status: "pending",
                position: insertAt + offset,
                created_at: now,
            })),
        });
        await Promise.all(afterTodos.map((todo, offset) => (
            tx.cronjob_run_todos.update({
                where: { id: todo.id },
                data: { position: insertAt + items.length + offset },
            })
        )));
    });

    res.json({ success: true, added_count: items.length });
}, true));

router.post("/runs/todos/finish-current", apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: "This endpoint requires an opencode session token"
        };
    }
    const summary = assertNonEmptyString(req.body?.summary, "summary");
    const run = await getPromptCronjobRun(req.opencode_session_id);
    assertActivePromptCronjobRun(run);
    const currentTodo = await prisma.cronjob_run_todos.findFirst({
        where: {
            run_id: run.id,
            status: "in_progress",
        },
        orderBy: { position: "asc" },
        select: { id: true },
    });
    if (!currentTodo) {
        throw {
            status: 400,
            message: "There is no current cronjob todo item to finish."
        };
    }
    await prisma.cronjob_run_todos.update({
        where: { id: currentTodo.id },
        data: {
            status: "completed",
            completed_at: nowMs(),
            summary,
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
    const run = await getPromptCronjobRun(req.opencode_session_id);
    assertActivePromptCronjobRun(run);
    const failedRun = await prisma.cronjob_runs.updateMany({
        where: { id: run.id, status: { in: ["running", "paused"] } },
        data: {
            status: "failed",
            completed_at: nowMs(),
            summary,
            error_message: summary,
        },
    });
    if (failedRun.count !== 1) {
        throw {
            status: 409,
            message: "Cronjob run is no longer active."
        };
    }
    res.json({ success: true });
}, true));

export default router;

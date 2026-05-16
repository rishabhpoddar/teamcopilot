import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-handoff-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_PORT = "4096";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const knownOpencodeSessionIds = new Set<string>();
    const promptCalls: unknown[] = [];
    const abortCalls: string[] = [];
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            list: async () => ({
                data: Array.from(knownOpencodeSessionIds).map((id) => ({ id, title: id })),
            }),
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
            promptAsync: async (input: unknown) => {
                promptCalls.push(input);
                return { data: { id: "prompt-ok" } };
            },
            abort: async (input: { path: { id: string } }) => {
                abortCalls.push(input.path.id);
                return { data: { success: true } };
            },
        },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/question?") || url.includes("/permission?")) {
            return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes("/question/") || url.includes("/permission/")) {
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const monitorIntervals: number[] = [];
    (globalThis as unknown as {
        setInterval: (handler: () => void, delay: number) => NodeJS.Timeout;
        clearInterval: (id: NodeJS.Timeout) => void;
    }).setInterval = ((_handler: () => void, delay: number) => {
        monitorIntervals.push(delay);
        return 0 as unknown as NodeJS.Timeout;
    }) as typeof setInterval;
    (globalThis as unknown as { clearInterval: (id: NodeJS.Timeout) => void }).clearInterval = (() => undefined) as typeof clearInterval;

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    function rememberSessionId(id: string): string {
        knownOpencodeSessionIds.add(id);
        return id;
    }

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `cronjob-handoff-${Date.now()}@example.com`,
                name: "Cronjob Handoff Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const otherUser = await prisma.users.create({
            data: {
                email: `cronjob-handoff-other-${Date.now()}@example.com`,
                name: "Other Handoff User",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId(`cronjob-handoff-auth-${Date.now()}`),
                title: "Auth",
                created_at: now,
                updated_at: now,
            },
        });

        const promptCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Prompt handoff cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Run prompt cronjob",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "*/10 * * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        const workflowCronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Workflow handoff cronjob",
                enabled: false,
                target_type: "workflow",
                prompt: null,
                prompt_allow_workflow_runs_without_permission: null,
                workflow_slug: "handoff-workflow",
                workflow_input_json: "{}",
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });
        const otherCronjob = await prisma.cronjobs.create({
            data: {
                user_id: otherUser.id,
                name: "Other prompt handoff cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Other user prompt",
                prompt_allow_workflow_runs_without_permission: true,
                workflow_slug: null,
                workflow_input_json: null,
                cron_expression: "0 9 * * *",
                timezone: "UTC",
                created_at: now,
                updated_at: now,
            },
        });

        const runningSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-running"),
                title: "Running prompt cron",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 1n,
            },
        });
        const runningRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "running",
                started_at: now + 1n,
                opencode_session_id: runningSession.opencode_session_id,
                session_id: runningSession.id,
            },
        });

        const pausedSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-paused"),
                title: "Paused prompt cron",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 2n,
            },
        });
        const pausedRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "paused",
                started_at: now + 2n,
                opencode_session_id: pausedSession.opencode_session_id,
                session_id: pausedSession.id,
            },
        });

        const terminalSessions: Array<{ status: string; sessionId: string; opencodeSessionId: string }> = [];
        for (const [index, status] of ["success", "failed", "terminated", "skipped"].entries()) {
            const session = await prisma.chat_sessions.create({
                data: {
                    user_id: user.id,
                    opencode_session_id: rememberSessionId(`cronjob-handoff-terminal-${status}`),
                    title: `Terminal ${status}`,
                    visible_to_user: true,
                    created_at: now,
                    updated_at: now + BigInt(10 + index),
                },
            });
            await prisma.cronjob_runs.create({
                data: {
                    cronjob_id: promptCronjob.id,
                    status,
                    started_at: now + BigInt(10 + index),
                    completed_at: now + BigInt(20 + index),
                    opencode_session_id: session.opencode_session_id,
                    session_id: session.id,
                },
            });
            terminalSessions.push({ status, sessionId: session.id, opencodeSessionId: session.opencode_session_id });
        }

        const workflowSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-workflow-visible"),
                title: "Workflow visible chat",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 30n,
            },
        });
        const workflowRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: workflowCronjob.id,
                status: "running",
                started_at: now + 30n,
                session_id: workflowSession.id,
                opencode_session_id: workflowSession.opencode_session_id,
            },
        });

        const otherSession = await prisma.chat_sessions.create({
            data: {
                user_id: otherUser.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-other-user"),
                title: "Other user visible chat",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 40n,
            },
        });
        const otherRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: otherCronjob.id,
                status: "paused",
                started_at: now + 40n,
                opencode_session_id: otherSession.opencode_session_id,
                session_id: otherSession.id,
            },
        });

        const app = createApp();
        const auth = { Authorization: `Bearer ${authSession.opencode_session_id}` };

        const sessionListResponse = await request(app)
            .get("/api/chat/sessions")
            .set(auth)
            .expect(200);
        const sessions = sessionListResponse.body.sessions as Array<{
            id: string;
            cronjob_control: null | {
                run_id: string;
                status: "running" | "paused";
                can_interrupt: boolean;
                can_resume: boolean;
                can_terminate: boolean;
            };
        }>;
        const runningListed = sessions.find((session) => session.id === runningSession.id);
        assert.deepEqual(runningListed?.cronjob_control, {
            run_id: runningRun.id,
            status: "running",
            can_interrupt: true,
            can_resume: false,
            can_terminate: true,
        });
        const pausedListed = sessions.find((session) => session.id === pausedSession.id);
        assert.deepEqual(pausedListed?.cronjob_control, {
            run_id: pausedRun.id,
            status: "paused",
            can_interrupt: false,
            can_resume: true,
            can_terminate: true,
        });
        for (const terminal of terminalSessions) {
            const listed = sessions.find((session) => session.id === terminal.sessionId);
            assert.equal(listed?.cronjob_control, null, `Terminal ${terminal.status} run should not expose cron controls`);
        }
        const workflowListed = sessions.find((session) => session.id === workflowSession.id);
        assert.equal(workflowListed?.cronjob_control, null, "Workflow cronjob chats should not expose prompt cron controls");
        assert.equal(sessions.some((session) => session.id === otherSession.id), false, "Other user's sessions must not be listed");

        for (const terminal of terminalSessions) {
            await request(app)
                .post(`/api/chat/sessions/${terminal.sessionId}/messages`)
                .set(auth)
                .send({ parts: [{ type: "text", text: "Can you continue?" }] })
                .expect(409)
                .expect((response) => {
                    assert.equal(response.body.message, `This cronjob chat is closed because the run is ${terminal.status}. Start a new chat or rerun the cronjob.`);
                });
        }
        assert.equal(promptCalls.length, 0, "Terminal cronjob chat messages must not be forwarded to OpenCode");

        await request(app)
            .post(`/api/chat/sessions/${runningSession.id}/abort`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
                assert.equal(response.body.cronjob_run_id, runningRun.id);
            });
        const interruptedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: runningRun.id } });
        assert.equal(interruptedRun.status, "paused");
        assert.deepEqual(abortCalls, [runningSession.opencode_session_id]);

        await prisma.cronjob_runs.update({
            where: { id: runningRun.id },
            data: { status: "running" },
        });
        await request(app)
            .post(`/api/cronjobs/runs/${pausedRun.id}/resume`)
            .set(auth)
            .expect(409)
            .expect((response) => {
                assert.equal(response.body.message, "Cronjob already has an active run. Wait for it to finish, resume it, or terminate it first.");
            });

        await prisma.cronjob_runs.update({
            where: { id: runningRun.id },
            data: { status: "terminated", completed_at: now + 50n },
        });
        const pausedSessionBeforeResume = await prisma.chat_sessions.findUniqueOrThrow({ where: { id: pausedSession.id } });
        await request(app)
            .post(`/api/cronjobs/runs/${pausedRun.id}/resume`)
            .set(auth)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });
        const resumedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: pausedRun.id } });
        assert.equal(resumedRun.status, "running");
        const pausedSessionAfterResume = await prisma.chat_sessions.findUniqueOrThrow({ where: { id: pausedSession.id } });
        assert.ok(pausedSessionAfterResume.updated_at > pausedSessionBeforeResume.updated_at, "Resume should bump chat updated_at");
        assert.equal(monitorIntervals.length, 1, "Resume should restart exactly one monitor");

        await request(app)
            .post(`/api/cronjobs/runs/${otherRun.id}/resume`)
            .set(auth)
            .expect(404);
        await request(app)
            .post(`/api/cronjobs/runs/${workflowRun.id}/resume`)
            .set(auth)
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "Only prompt cronjob chats can be resumed.");
            });
        await prisma.cronjob_runs.update({
            where: { id: pausedRun.id },
            data: { status: "terminated", completed_at: now + 55n },
        });

        const hiddenAskSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-ask-user"),
                title: "Hidden ask user chat",
                visible_to_user: false,
                created_at: now,
                updated_at: now + 60n,
            },
        });
        const hiddenAskRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "running",
                started_at: now + 60n,
                opencode_session_id: hiddenAskSession.opencode_session_id,
                session_id: hiddenAskSession.id,
            },
        });
        await request(app)
            .post("/api/cronjobs/runs/ask-user-current")
            .set("Authorization", `Bearer ${hiddenAskSession.opencode_session_id}`)
            .send({ message: "Need user clarification" })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
                assert.equal(response.body.message, "Need user clarification");
            });
        const askRunAfter = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: hiddenAskRun.id } });
        assert.equal(askRunAfter.status, "paused");
        const askSessionAfter = await prisma.chat_sessions.findUniqueOrThrow({ where: { id: hiddenAskSession.id } });
        assert.equal(askSessionAfter.visible_to_user, true);

        const pausedTodoSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-paused-tools"),
                title: "Paused tool chat",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 70n,
            },
        });
        const pausedTodoRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "paused",
                started_at: now + 70n,
                opencode_session_id: pausedTodoSession.opencode_session_id,
                session_id: pausedTodoSession.id,
            },
        });
        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${pausedTodoSession.opencode_session_id}`)
            .send({ items: ["First paused todo"], index: 0, todo_list_version: 0 })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.added_count, 1);
            });
        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${pausedTodoSession.opencode_session_id}`)
            .send({ items: ["Inserted paused todo"], index: 0, todo_list_version: 1 })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.added_count, 1);
            });
        const pausedTodos = await prisma.cronjob_run_todos.findMany({
            where: { run_id: pausedTodoRun.id },
            orderBy: { position: "asc" },
        });
        assert.deepEqual(pausedTodos.map((todo) => todo.content), ["Inserted paused todo", "First paused todo"]);
        assert.deepEqual(pausedTodos.map((todo) => todo.status), ["pending", "pending"]);

        await prisma.cronjob_runs.update({
            where: { id: pausedTodoRun.id },
            data: { status: "failed", completed_at: now + 80n },
        });
        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${pausedTodoSession.opencode_session_id}`)
            .send({ items: ["Should be rejected"], index: 0, todo_list_version: 0 })
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "Cronjob session is already finished. Current state is: failed");
            });

        const pausedFinishSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-paused-finish-current"),
                title: "Paused finish current todo",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 90n,
            },
        });
        const pausedFinishRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "paused",
                started_at: now + 90n,
                opencode_session_id: pausedFinishSession.opencode_session_id,
                session_id: pausedFinishSession.id,
            },
        });
        const pausedInProgressTodo = await prisma.cronjob_run_todos.create({
            data: {
                run_id: pausedFinishRun.id,
                content: "Finish while paused",
                status: "in_progress",
                position: 0,
                created_at: now + 90n,
            },
        });
        await request(app)
            .post("/api/cronjobs/runs/todos/finish-current")
            .set("Authorization", `Bearer ${pausedFinishSession.opencode_session_id}`)
            .send({ completionSummary: "Finished during user handoff" })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });
        const finishedPausedTodo = await prisma.cronjob_run_todos.findUniqueOrThrow({ where: { id: pausedInProgressTodo.id } });
        assert.equal(finishedPausedTodo.status, "completed");
        assert.equal(finishedPausedTodo.summary, "Finished during user handoff");

        const pausedCompleteSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-paused-complete"),
                title: "Paused complete run",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 100n,
            },
        });
        const pausedCompleteRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "paused",
                started_at: now + 100n,
                opencode_session_id: pausedCompleteSession.opencode_session_id,
                session_id: pausedCompleteSession.id,
            },
        });
        await prisma.cronjob_run_todos.create({
            data: {
                run_id: pausedCompleteRun.id,
                content: "Already complete",
                status: "completed",
                position: 0,
                summary: "Done",
                created_at: now + 100n,
                completed_at: now + 100n,
            },
        });
        await request(app)
            .post("/api/cronjobs/runs/complete-current")
            .set("Authorization", `Bearer ${pausedCompleteSession.opencode_session_id}`)
            .send({ summary: "Completed from paused state" })
            .expect(200);
        const completedPausedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: pausedCompleteRun.id } });
        assert.equal(completedPausedRun.status, "success");
        assert.equal(completedPausedRun.summary, "Completed from paused state");

        const pausedFailSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId("cronjob-handoff-paused-fail"),
                title: "Paused fail run",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 110n,
            },
        });
        const pausedFailRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: promptCronjob.id,
                status: "paused",
                started_at: now + 110n,
                opencode_session_id: pausedFailSession.opencode_session_id,
                session_id: pausedFailSession.id,
            },
        });
        await request(app)
            .post("/api/cronjobs/runs/fail-current")
            .set("Authorization", `Bearer ${pausedFailSession.opencode_session_id}`)
            .send({ summary: "Failed from paused state" })
            .expect(200);
        const failedPausedRun = await prisma.cronjob_runs.findUniqueOrThrow({ where: { id: pausedFailRun.id } });
        assert.equal(failedPausedRun.status, "failed");
        assert.equal(failedPausedRun.error_message, "Failed from paused state");

        console.log("Cronjob chat handoff and resume regression tests passed");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

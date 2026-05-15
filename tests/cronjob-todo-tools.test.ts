import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cronjob-todos-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_PORT = "4096";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            list: async () => ({ data: [] }),
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
            promptAsync: async () => ({ data: { id: "prompt-ok" } }),
            abort: async () => ({ data: { success: true } }),
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

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `cronjob-todos-${Date.now()}@example.com`,
                name: "Cronjob Todo Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const cronjob = await prisma.cronjobs.create({
            data: {
                user_id: user.id,
                name: "Todo tools prompt cronjob",
                enabled: false,
                target_type: "prompt",
                prompt: "Manage todos",
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
                opencode_session_id: "cronjob-todo-running",
                title: "Running todo session",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 1n,
            },
        });
        const runningRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "running",
                started_at: now + 1n,
                opencode_session_id: runningSession.opencode_session_id,
                session_id: runningSession.id,
            },
        });
        const runningCurrentTodo = await prisma.cronjob_run_todos.create({
            data: {
                run_id: runningRun.id,
                content: "Current running todo",
                status: "in_progress",
                position: 0,
                created_at: now + 2n,
            },
        });
        const runningPendingTodo = await prisma.cronjob_run_todos.create({
            data: {
                run_id: runningRun.id,
                content: "Pending running todo",
                status: "pending",
                position: 1,
                created_at: now + 3n,
            },
        });
        await prisma.cronjob_run_todos.create({
            data: {
                run_id: runningRun.id,
                content: "Completed running todo",
                status: "completed",
                position: 2,
                summary: "done",
                created_at: now + 4n,
                completed_at: now + 4n,
            },
        });

        const pausedSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: "cronjob-todo-paused",
                title: "Paused todo session",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 10n,
            },
        });
        const pausedRun = await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "paused",
                started_at: now + 10n,
                opencode_session_id: pausedSession.opencode_session_id,
                session_id: pausedSession.id,
            },
        });

        const terminalSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: "cronjob-todo-terminal",
                title: "Terminal todo session",
                visible_to_user: true,
                created_at: now,
                updated_at: now + 20n,
            },
        });
        await prisma.cronjob_runs.create({
            data: {
                cronjob_id: cronjob.id,
                status: "terminated",
                started_at: now + 20n,
                completed_at: now + 30n,
                opencode_session_id: terminalSession.opencode_session_id,
                session_id: terminalSession.id,
            },
        });

        const app = createApp();

        await request(app)
            .get("/api/cronjobs/runs/todos/not-completed")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.todo_list_version, 0);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Current running todo",
                    "Pending running todo",
                ]);
                assert.deepEqual(response.body.todos.map((todo: { status: string }) => todo.status), [
                    "in_progress",
                    "pending",
                ]);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .send({ items: ["Out of range"], index: 3, todo_list_version: 0 })
            .expect(400)
            .expect((response) => {
                assert.match(response.body.message, /^index must be less than or equal to the current active todo count \(2\)\./);
                assert.match(response.body.message, /Current todo list: \[/);
                assert.match(response.body.message, new RegExp(runningCurrentTodo.id));
                assert.match(response.body.message, new RegExp(runningPendingTodo.id));
                assert.match(response.body.message, /"content":"Current running todo"/);
                assert.match(response.body.message, /"content":"Pending running todo"/);
                assert.match(response.body.message, /"completionSummary":null/);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .send({ items: ["Inserted todo"], index: 1, todo_list_version: 0 })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.added_count, 1);
                assert.equal(response.body.added_todo_ids.length, 1);
                assert.equal(response.body.todo_list_version, 1);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Current running todo",
                    "Inserted todo",
                    "Pending running todo",
                ]);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .send({ items: ["Should be rejected because snapshot is stale"], index: 1, todo_list_version: 0 })
            .expect(400)
            .expect((response) => {
                assert.match(response.body.message, /^Call getCronjobTodos immediately before addCronjobTodos\./);
                assert.match(response.body.message, /stale \(expected version 1, got 0\)/);
                assert.match(response.body.message, /Current todo list: \[/);
            });

        const afterInsertTodos = await prisma.cronjob_run_todos.findMany({
            where: { run_id: runningRun.id, status: { not: "completed" } },
            orderBy: { position: "asc" },
        });
        assert.deepEqual(afterInsertTodos.map((todo) => todo.content), [
            "Current running todo",
            "Inserted todo",
            "Pending running todo",
        ]);
        assert.deepEqual(afterInsertTodos.map((todo) => todo.position), [0, 1, 2]);

        await request(app)
            .post("/api/cronjobs/runs/todos/clear")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .send({ todo_ids: [afterInsertTodos[1].id] })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.cleared_count, 1);
                assert.equal(response.body.cleared_todo_ids.length, 1);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Current running todo",
                    "Pending running todo",
                ]);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/clear")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .send({ todo_ids: [runningCurrentTodo.id] })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.cleared_count, 1);
                assert.equal(response.body.cleared_todo_ids.length, 1);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Pending running todo",
                ]);
            });

        await request(app)
            .get("/api/cronjobs/runs/todos/not-completed")
            .set("Authorization", `Bearer ${runningSession.opencode_session_id}`)
            .expect(200)
            .expect((response) => {
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Pending running todo",
                ]);
                assert.deepEqual(response.body.todos.map((todo: { status: string }) => todo.status), [
                    "pending",
                ]);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${pausedSession.opencode_session_id}`)
            .send({ items: ["Paused first", "Paused second"], index: 0, todo_list_version: 0 })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.added_count, 2);
                assert.equal(response.body.added_todo_ids.length, 2);
                assert.equal(response.body.todo_list_version, 1);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Paused first",
                    "Paused second",
                ]);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${pausedSession.opencode_session_id}`)
            .send({ items: ["Paused append"], index: 2, todo_list_version: 1 })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.added_count, 1);
                assert.equal(response.body.added_todo_ids.length, 1);
                assert.equal(response.body.todo_list_version, 2);
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Paused first",
                    "Paused second",
                    "Paused append",
                ]);
            });

        await request(app)
            .get("/api/cronjobs/runs/todos/not-completed")
            .set("Authorization", `Bearer ${pausedSession.opencode_session_id}`)
            .expect(200)
            .expect((response) => {
                assert.deepEqual(response.body.todos.map((todo: { content: string }) => todo.content), [
                    "Paused first",
                    "Paused second",
                    "Paused append",
                ]);
            });

        const pausedTodos = await prisma.cronjob_run_todos.findMany({
            where: { run_id: pausedRun.id, status: { not: "completed" } },
            orderBy: { position: "asc" },
        });
        await request(app)
            .post("/api/cronjobs/runs/todos/clear")
            .set("Authorization", `Bearer ${pausedSession.opencode_session_id}`)
            .send({ todo_ids: pausedTodos.map((todo) => todo.id) })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.cleared_count, 3);
                assert.equal(response.body.cleared_todo_ids.length, 3);
                assert.deepEqual(response.body.todos, []);
            });

        await request(app)
            .post("/api/cronjobs/runs/todos/add")
            .set("Authorization", `Bearer ${terminalSession.opencode_session_id}`)
            .send({ items: ["Should be rejected"], index: 0, todo_list_version: 0 })
            .expect(400)
            .expect((response) => {
                assert.equal(response.body.message, "Cronjob session is already finished. Current state is: terminated");
            });

        console.log("Cronjob todo tools route tests passed");
    } finally {
        globalThis.fetch = originalFetch;
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

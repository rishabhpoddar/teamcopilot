import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-chat-sessions-time-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_PORT = "4096";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const knownOpencodeSessionIds = new Set<string>();
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            list: async () => ({
                data: Array.from(knownOpencodeSessionIds).map((id) => ({ id, title: id })),
            }),
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
        },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/question?") || url.includes("/permission?")) {
            return new Response(JSON.stringify([]), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

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
                email: `chat-sessions-time-${Date.now()}@example.com`,
                name: "Chat Sessions Time Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId(`chat-sessions-time-auth-${Date.now()}`),
                title: "Auth",
                created_at: now,
                updated_at: now,
            },
        });

        const recentSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId(`chat-sessions-time-recent-${Date.now()}`),
                title: "Recent session",
                created_at: now,
                updated_at: now,
            },
        });

        const elevenDaysMs = 11n * 24n * 60n * 60n * 1000n;
        const oldSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: rememberSessionId(`chat-sessions-time-old-${Date.now()}`),
                title: "Old session",
                created_at: now - elevenDaysMs,
                updated_at: now - elevenDaysMs,
            },
        });

        const app = createApp();
        const auth = { Authorization: `Bearer ${authSession.opencode_session_id}` };

        const recentResponse = await request(app)
            .get("/api/chat/sessions")
            .query({ time: "recent" })
            .set(auth)
            .expect(200);

        const recentIds = (recentResponse.body.sessions as Array<{ id: string }>).map((session) => session.id);
        assert.equal(recentResponse.body.has_older_sessions, true);
        assert.ok(recentIds.includes(recentSession.id));
        assert.ok(!recentIds.includes(oldSession.id));

        const allResponse = await request(app)
            .get("/api/chat/sessions")
            .query({ time: "all" })
            .set(auth)
            .expect(200);

        const allIds = (allResponse.body.sessions as Array<{ id: string }>).map((session) => session.id);
        assert.equal(allResponse.body.has_older_sessions, false);
        assert.ok(allIds.includes(recentSession.id));
        assert.ok(allIds.includes(oldSession.id));

        const defaultResponse = await request(app)
            .get("/api/chat/sessions")
            .set(auth)
            .expect(200);
        const defaultIds = (defaultResponse.body.sessions as Array<{ id: string }>).map((session) => session.id);
        assert.ok(!defaultIds.includes(oldSession.id));

        await request(app)
            .get("/api/chat/sessions")
            .query({ time: "invalid" })
            .set(auth)
            .expect(400);

        console.log("chat-sessions-list-time-filter.test.ts passed");
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-chat-msg-page-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_PORT = "4096";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const messagePages: Record<string, Array<{ info: { id: string; role: string; time: { created: number } }; parts: [] }>> = {
        "page-1": [
            { info: { id: "msg-3", role: "assistant", time: { created: 3 } }, parts: [] },
            { info: { id: "msg-4", role: "user", time: { created: 4 } }, parts: [] },
            { info: { id: "msg-5", role: "assistant", time: { created: 5 } }, parts: [] },
        ],
        "page-2": [
            { info: { id: "msg-1", role: "user", time: { created: 1 } }, parts: [] },
            { info: { id: "msg-2", role: "assistant", time: { created: 2 } }, parts: [] },
        ],
    };

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            status: async () => ({ data: {} }),
            messages: async (input: { query?: { limit?: number; before?: string } }) => {
                const headers = new Headers();
                if (!input.query?.limit) {
                    return { data: [...messagePages["page-2"], ...messagePages["page-1"]] };
                }
                if (input.query.before === "cursor-older") {
                    return {
                        data: messagePages["page-2"],
                        response: new Response(null, { headers }),
                    };
                }
                headers.set("x-next-cursor", "cursor-older");
                return {
                    data: messagePages["page-1"],
                    response: new Response(null, { headers }),
                };
            },
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

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `chat-msg-page-${Date.now()}@example.com`,
                name: "Chat Messages Page Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `chat-msg-page-session-${Date.now()}`,
                title: "Auth",
                created_at: now,
                updated_at: now,
            },
        });
        const chatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `chat-msg-page-target-${Date.now()}`,
                title: "Target",
                created_at: now,
                updated_at: now,
            },
        });

        const app = createApp();
        const auth = { Authorization: `Bearer ${authSession.opencode_session_id}` };

        const firstPage = await request(app)
            .get(`/api/chat/sessions/${chatSession.id}/messages`)
            .set(auth)
            .expect(200);

        assert.equal(firstPage.body.page_size, 10);
        assert.equal(firstPage.body.has_more, true);
        assert.equal(firstPage.body.next_cursor, "cursor-older");
        assert.equal(firstPage.body.messages.length, 3);
        assert.equal(firstPage.body.messages[0].info.id, "msg-3");
        assert.equal(firstPage.body.messages[2].info.id, "msg-5");

        const secondPage = await request(app)
            .get(`/api/chat/sessions/${chatSession.id}/messages`)
            .query({ before: "cursor-older" })
            .set(auth)
            .expect(200);

        assert.equal(secondPage.body.page_size, 10);
        assert.equal(secondPage.body.has_more, false);
        assert.equal(secondPage.body.next_cursor, null);
        assert.equal(secondPage.body.messages.length, 2);
        assert.equal(secondPage.body.messages[0].info.id, "msg-1");

        console.log("chat-messages-pagination.test.ts passed");
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});

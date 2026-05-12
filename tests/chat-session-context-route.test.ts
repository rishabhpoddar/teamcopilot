import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-chat-context-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_PORT = "4096";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const promptBodies: unknown[] = [];
    let hasExistingMessages = false;
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            create: async () => ({ data: { id: "ses-chat-context", title: "Context test" } }),
            messages: async () => ({ data: hasExistingMessages ? [{ info: { id: "msg-existing", role: "user" }, parts: [] }] : [] }),
            promptAsync: async (input: unknown) => {
                promptBodies.push(input);
                hasExistingMessages = true;
                return { data: { id: "prompt-ok" } };
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
                email: `chat-context-${Date.now()}@example.com`,
                name: "Chat Context Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `chat-context-auth-${Date.now()}`,
                title: "Auth",
                created_at: now,
                updated_at: now,
            },
        });

        const app = createApp();
        const createResponse = await request(app)
            .post("/api/chat/sessions")
            .set("Authorization", `Bearer ${authSession.opencode_session_id}`)
            .expect(200);

        const sessionId = String(createResponse.body.session.id);
        await request(app)
            .post(`/api/chat/sessions/${sessionId}/messages`)
            .set("Authorization", `Bearer ${authSession.opencode_session_id}`)
            .send({ parts: [{ type: "text", text: "What time is it?" }] })
            .expect(200);

        assert.equal(promptBodies.length, 1);
        const firstBody = promptBodies[0] as { body: { parts: Array<{ type: string; text?: string }> } };
        assert.equal(firstBody.body.parts[0].type, "text");
        assert.ok(firstBody.body.parts[0].text?.includes("# Current time"));
        assert.ok(firstBody.body.parts[0].text?.includes("Current timezone:"));
        assert.ok(firstBody.body.parts[0].text?.includes("Current UTC time:"));
        assert.ok(firstBody.body.parts[0].text?.includes("####### Actual user message below #######"));
        assert.equal(firstBody.body.parts[1].text, "What time is it?");

        await request(app)
            .post(`/api/chat/sessions/${sessionId}/messages`)
            .set("Authorization", `Bearer ${authSession.opencode_session_id}`)
            .send({ parts: [{ type: "text", text: "Second message" }] })
            .expect(200);

        assert.equal(promptBodies.length, 2);
        const secondBody = promptBodies[1] as { body: { parts: Array<{ type: string; text?: string }> } };
        assert.equal(secondBody.body.parts.length, 1);
        assert.equal(secondBody.body.parts[0].text, "Second message");
        assert.ok(!String(secondBody.body.parts[0].text).includes("# Current time"));

        console.log("Chat session context route tests passed");
    } finally {
        globalThis.fetch = originalFetch;
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

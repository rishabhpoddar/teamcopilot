import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type MockMessage = {
    info: {
        id: string;
        role: "user" | "assistant";
        time: {
            created: number;
            completed?: number;
        };
        modelID?: string;
        providerID?: string;
        tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache: {
                read: number;
                write: number;
            };
        };
    };
};

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-usage-incomplete-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_MODEL = "openai/gpt-5.3-codex";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const incompletePage: MockMessage[] = [
        { info: { id: "msg-1", role: "user", time: { created: 1 } } },
        {
            info: {
                id: "msg-2",
                role: "assistant",
                time: { created: 2 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                },
            },
        },
    ];

    const completePage: MockMessage[] = [
        { info: { id: "msg-1", role: "user", time: { created: 1 } } },
        {
            info: {
                id: "msg-2",
                role: "assistant",
                time: { created: 2, completed: 2 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 12,
                    output: 120,
                    reasoning: 0,
                    cache: { read: 6, write: 0 },
                },
            },
        },
    ];

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const calls: Array<{ query?: { limit?: number; before?: string } }> = [];
    let phase = 0;
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            messages: async (input: { query?: { limit?: number; before?: string } }) => {
                calls.push(input);
                const headers = new Headers();
                if (input.query?.before !== undefined) {
                    throw new Error(`Unexpected before cursor: ${String(input.query.before)}`);
                }
                phase += 1;
                return {
                    data: phase === 1 ? incompletePage : completePage,
                    response: new Response(null, { headers }),
                };
            },
        },
    });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { calculateEstimatedCostUsd } = require("../src/utils/model-pricing") as typeof import("../src/utils/model-pricing");
    const { syncChatSessionUsage } = require("../src/utils/chat-usage") as typeof import("../src/utils/chat-usage");

    try {
        await ensureWorkspaceDatabase();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `usage-incomplete-${Date.now()}@example.com`,
                name: "Usage Incomplete Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const chatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `usage-incomplete-session-${Date.now()}`,
                title: "Usage incomplete session",
                created_at: now,
                updated_at: now,
            },
        });

        await syncChatSessionUsage(chatSession.id, chatSession.opencode_session_id);

        assert.equal(calls.length, 1);
        const usageAfterIncomplete = await prisma.chat_session_usage.findUnique({
            where: { chat_session_id: chatSession.id },
        });
        assert.equal(usageAfterIncomplete, null);

        await syncChatSessionUsage(chatSession.id, chatSession.opencode_session_id);

        assert.equal(calls.length, 2);
        const usageAfterComplete = await prisma.chat_session_usage.findUnique({
            where: { chat_session_id: chatSession.id },
        });
        assert.ok(usageAfterComplete);
        assert.equal(usageAfterComplete.last_synced_message_id, "msg-2");
        assert.equal(usageAfterComplete.input_tokens, 12);
        assert.equal(usageAfterComplete.output_tokens, 120);
        assert.equal(usageAfterComplete.cached_tokens, 6);
        assert.equal(
            usageAfterComplete.cost_usd,
            calculateEstimatedCostUsd({
                providerId: "openai",
                modelId: "gpt-5.3-codex",
                inputTokens: 12,
                outputTokens: 120,
                cachedTokens: 6,
            })
        );

        console.log("chat-usage-incomplete-assistant.test.ts passed");
    } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});

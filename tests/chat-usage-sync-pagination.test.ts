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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-usage-sync-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.OPENCODE_MODEL = "openai/gpt-5.3-codex";

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const page1: MockMessage[] = [
        { info: { id: "msg-7", role: "user", time: { created: 7 } } },
        {
            info: {
                id: "msg-8",
                role: "assistant",
                time: { created: 8, completed: 8 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 8,
                    output: 80,
                    reasoning: 0,
                    cache: { read: 4, write: 0 },
                },
            },
        },
        { info: { id: "msg-9", role: "user", time: { created: 9 } } },
        {
            info: {
                id: "msg-10",
                role: "assistant",
                time: { created: 10, completed: 10 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 10,
                    output: 100,
                    reasoning: 0,
                    cache: { read: 5, write: 0 },
                },
            },
        },
    ];
    const page2: MockMessage[] = [
        { info: { id: "msg-3", role: "user", time: { created: 3 } } },
        {
            info: {
                id: "msg-4",
                role: "assistant",
                time: { created: 4, completed: 4 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 4,
                    output: 40,
                    reasoning: 0,
                    cache: { read: 2, write: 0 },
                },
            },
        },
        { info: { id: "msg-5", role: "user", time: { created: 5 } } },
        {
            info: {
                id: "msg-6",
                role: "assistant",
                time: { created: 6, completed: 6 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 6,
                    output: 60,
                    reasoning: 0,
                    cache: { read: 3, write: 0 },
                },
            },
        },
    ];
    const page3: MockMessage[] = [
        { info: { id: "msg-1", role: "user", time: { created: 1 } } },
        {
            info: {
                id: "msg-2",
                role: "assistant",
                time: { created: 2, completed: 2 },
                modelID: "gpt-5.3-codex",
                providerID: "openai",
                tokens: {
                    input: 2,
                    output: 20,
                    reasoning: 0,
                    cache: { read: 1, write: 0 },
                },
            },
        },
    ];

    const opencodeClientModule = require("../src/utils/opencode-client") as typeof import("../src/utils/opencode-client");
    const calls: Array<{ query?: { limit?: number; before?: string } }> = [];
    (opencodeClientModule as unknown as {
        getOpencodeClient: () => Promise<unknown>;
    }).getOpencodeClient = async () => ({
        session: {
            messages: async (input: { query?: { limit?: number; before?: string } }) => {
                calls.push(input);
                const headers = new Headers();
                if (input.query?.before === undefined) {
                    headers.set("x-next-cursor", "cursor-msg-7");
                    return { data: page1, response: new Response(null, { headers }) };
                }
                if (input.query.before === "cursor-msg-7") {
                    headers.set("x-next-cursor", "cursor-msg-3");
                    return { data: page2, response: new Response(null, { headers }) };
                }
                if (input.query.before === "cursor-msg-3") {
                    return { data: page3, response: new Response(null, { headers }) };
                }
                throw new Error(`Unexpected before cursor: ${String(input.query?.before)}`);
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
                email: `usage-sync-${Date.now()}@example.com`,
                name: "Usage Sync Tester",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const chatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `usage-sync-session-${Date.now()}`,
                title: "Usage sync session",
                created_at: now,
                updated_at: now,
            },
        });

        await prisma.chat_session_usage.create({
            data: {
                chat_session_id: chatSession.id,
                last_synced_message_id: "msg-4",
                provider_id: "openai",
                input_tokens: 12,
                output_tokens: 120,
                cached_tokens: 6,
                cost_usd: 0.001,
                model_id: "gpt-5.3-codex",
                updated_at: now,
            },
        });

        await syncChatSessionUsage(chatSession.id, chatSession.opencode_session_id);

        assert.equal(calls.length, 2);
        assert.equal(calls[0].query?.limit, 100);
        assert.equal(calls[0].query?.before, undefined);
        assert.equal(calls[1].query?.limit, 100);
        assert.equal(calls[1].query?.before, "cursor-msg-7");

        const usage = await prisma.chat_session_usage.findUnique({
            where: { chat_session_id: chatSession.id },
        });
        assert.ok(usage);
        assert.equal(usage.last_synced_message_id, "msg-10");
        assert.equal(usage.input_tokens, 12 + 6 + 8 + 10);
        assert.equal(usage.output_tokens, 120 + 60 + 80 + 100);
        assert.equal(usage.cached_tokens, 6 + 3 + 4 + 5);
        assert.equal(
            usage.cost_usd,
            0.001 + calculateEstimatedCostUsd({
                providerId: "openai",
                modelId: "gpt-5.3-codex",
                inputTokens: 6 + 8 + 10,
                outputTokens: 60 + 80 + 100,
                cachedTokens: 3 + 4 + 5,
            })
        );

        calls.length = 0;

        const firstSyncChatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `usage-sync-first-${Date.now()}`,
                title: "Usage sync first session",
                created_at: now,
                updated_at: now,
            },
        });

        await syncChatSessionUsage(firstSyncChatSession.id, firstSyncChatSession.opencode_session_id);

        assert.equal(calls.length, 1);
        assert.equal(calls[0].query, undefined);

        const firstSyncUsage = await prisma.chat_session_usage.findUnique({
            where: { chat_session_id: firstSyncChatSession.id },
        });
        assert.ok(firstSyncUsage);
        assert.equal(firstSyncUsage.last_synced_message_id, "msg-10");
        assert.equal(firstSyncUsage.input_tokens, 8 + 10);
        assert.equal(firstSyncUsage.output_tokens, 80 + 100);
        assert.equal(firstSyncUsage.cached_tokens, 4 + 5);
        assert.equal(
            firstSyncUsage.cost_usd,
            calculateEstimatedCostUsd({
                providerId: "openai",
                modelId: "gpt-5.3-codex",
                inputTokens: 8 + 10,
                outputTokens: 80 + 100,
                cachedTokens: 4 + 5,
            })
        );

        console.log("chat-usage-sync-pagination.test.ts passed");
    } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});

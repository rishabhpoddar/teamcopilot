import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-usage-route-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const oneDayMs = 24n * 60n * 60n * 1000n;

        const viewer = await prisma.users.create({
            data: {
                email: `usage-viewer-${Date.now()}@example.com`,
                name: "Usage Viewer",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            }
        });

        const otherUser = await prisma.users.create({
            data: {
                email: `usage-other-${Date.now()}@example.com`,
                name: "Usage Other",
                role: "User",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            }
        });

        const authSession = await prisma.chat_sessions.create({
            data: {
                user_id: viewer.id,
                opencode_session_id: `usage-auth-${Date.now()}`,
                title: "Usage auth session",
                created_at: now,
                updated_at: now,
            }
        });

        const sessionOne = await prisma.chat_sessions.create({
            data: {
                user_id: viewer.id,
                opencode_session_id: `usage-data-1-${Date.now()}`,
                title: "Usage session one",
                created_at: now - oneDayMs,
                updated_at: now - oneDayMs,
            }
        });

        const sessionTwo = await prisma.chat_sessions.create({
            data: {
                user_id: otherUser.id,
                opencode_session_id: `usage-data-2-${Date.now()}`,
                title: "Usage session two",
                created_at: now,
                updated_at: now,
            }
        });

        const oldSession = await prisma.chat_sessions.create({
            data: {
                user_id: otherUser.id,
                opencode_session_id: `usage-old-${Date.now()}`,
                title: "Old usage session",
                created_at: now - (120n * oneDayMs),
                updated_at: now - (120n * oneDayMs),
            }
        });

        await prisma.chat_session_usage.createMany({
            data: [
                {
                    chat_session_id: sessionOne.id,
                    input_tokens: 1000,
                    output_tokens: 300,
                    cached_tokens: 200,
                    cost_usd: 0.003375,
                    model_id: "gpt-5.3-codex",
                    updated_at: now - oneDayMs,
                },
                {
                    chat_session_id: sessionTwo.id,
                    input_tokens: 400,
                    output_tokens: 100,
                    cached_tokens: 50,
                    cost_usd: 0,
                    model_id: "unknown-model",
                    updated_at: now,
                },
                {
                    chat_session_id: oldSession.id,
                    input_tokens: 9999,
                    output_tokens: 999,
                    cached_tokens: 999,
                    cost_usd: 9.99,
                    model_id: "gpt-5.3-codex",
                    updated_at: now - (120n * oneDayMs),
                }
            ]
        });

        const app = createApp();
        const response = await request(app)
            .get("/api/usage/overview")
            .query({ range: "7d" })
            .set("Authorization", `Bearer ${authSession.opencode_session_id}`)
            .expect(200);

        assert.equal(response.body.estimated, true);
        assert.equal(response.body.summary.total_input_tokens, 1400);
        assert.equal(response.body.summary.total_output_tokens, 400);
        assert.equal(response.body.summary.total_cached_tokens, 250);
        assert.equal(response.body.summary.session_count, 2);
        assert.equal(response.body.models.length, 2);
        assert.ok(Math.abs((response.body.summary.total_cost_usd as number) - 0.003375) < 1e-9);
        assert.ok(Array.isArray(response.body.timeseries));
        assert.ok(response.body.timeseries.length >= 7);
        assert.ok(response.body.pricing["gpt-5.3-codex"]);
        assert.equal(response.body.pricing["unknown-model"], undefined);

        console.log("Usage overview route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

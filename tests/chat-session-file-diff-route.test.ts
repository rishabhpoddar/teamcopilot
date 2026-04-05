import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-chat-session-diff-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills", "demo-skill"), { recursive: true });
    fs.writeFileSync(
        path.join(workspaceDir, ".agents", "skills", "demo-skill", "SKILL.md"),
        `---
name: "demo-skill"
description: "Route diff test"
required_secrets:
  - GITHUB_TOKEN
---

Use {{SECRET:GITHUB_TOKEN}} in the current version.
`,
        "utf-8",
    );
    fs.writeFileSync(
        path.join(workspaceDir, ".agents", "skills", "demo-skill", ".env"),
        "SECRET=live-value\n",
        "utf-8",
    );

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
                email: `chat-session-diff-${Date.now()}@example.com`,
                name: "Chat Session Diff Tester",
                role: "Engineer",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });

        const chatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `chat-session-diff-opencode-${Date.now()}`,
                title: "Chat session diff route test",
                created_at: now,
                updated_at: now,
            }
        });

        await prisma.chat_session_tracked_files.createMany({
            data: [
                {
                    chat_session_id: chatSession.id,
                    relative_path: ".agents/skills/demo-skill/SKILL.md",
                    existed_at_baseline: true,
                    content_kind: "text",
                    text_content: `---
name: "demo-skill"
description: "Route diff test"
required_secrets:
  - GITHUB_TOKEN
---

Use the skill without placeholders in the baseline.
`,
                    binary_content: null,
                    size_bytes: 0,
                    content_sha256: "baseline-skill-md",
                    created_at: now,
                    updated_at: now,
                },
                {
                    chat_session_id: chatSession.id,
                    relative_path: ".agents/skills/demo-skill/.env",
                    existed_at_baseline: true,
                    content_kind: "text",
                    text_content: "SECRET=baseline-value\n",
                    binary_content: null,
                    size_bytes: 0,
                    content_sha256: "baseline-dotenv",
                    created_at: now,
                    updated_at: now,
                }
            ]
        });

        const app = createApp();
        const response = await request(app)
            .get(`/api/chat/sessions/${chatSession.id}/file-diff`)
            .set("Authorization", `Bearer ${chatSession.opencode_session_id}`)
            .expect(200);

        const diffJson = JSON.stringify(response.body);
        assert.ok(
            diffJson.includes("{{SECRET:GITHUB_TOKEN}}"),
            `Expected chat session diff to include the raw skill placeholder, got: ${diffJson}`
        );
        assert.ok(
            !diffJson.includes(".env"),
            `Expected chat session diff to exclude .env files, got: ${diffJson}`
        );

        console.log("Chat session file diff route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

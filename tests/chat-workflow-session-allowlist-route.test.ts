import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-chat-workflow-allowlist-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.TEAMCOPILOT_HOST = "127.0.0.1";
    process.env.TEAMCOPILOT_PORT = "5124";
    process.env.EXTERNAL_HOST = "///127.0.0.1:5124///";

    const workflowSlug = "allowlist-demo";
    const workflowDir = path.join(workspaceDir, "workflows", workflowSlug);
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
        path.join(workflowDir, "workflow.json"),
        JSON.stringify({
            intent_summary: "Allowlist demo workflow",
            inputs: {},
            required_secrets: [],
            triggers: { manual: true },
            runtime: { timeout_seconds: 30 },
        }, null, 2),
        "utf-8",
    );
    fs.writeFileSync(path.join(workflowDir, "run.py"), "print('ok')\n", "utf-8");

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { setWorkflowCreator } = require("../src/utils/workflow") as typeof import("../src/utils/workflow");
    const { approveWorkflowWithSnapshot } = require("../src/utils/workflow-approval-snapshot") as typeof import("../src/utils/workflow-approval-snapshot");
    const { initializeWorkflowRunPermissionsForCreator } = require("../src/utils/workflow-permissions") as typeof import("../src/utils/workflow-permissions");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `allowlist-${Date.now()}@example.com`,
                name: "Allowlist Tester",
                role: "Engineer",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const session = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `allowlist-session-${Date.now()}`,
                title: "Allowlist session",
                created_at: now,
                updated_at: now,
            },
        });

        await setWorkflowCreator(workflowSlug, user.id);
        await initializeWorkflowRunPermissionsForCreator(workflowSlug, user.id);
        await approveWorkflowWithSnapshot(workflowSlug, user.id);

        const permission = await prisma.tool_execution_permissions.create({
            data: {
                opencode_session_id: session.opencode_session_id,
                workflow_slug: workflowSlug,
                message_id: `message-${Date.now()}`,
                call_id: `call-${Date.now()}`,
                status: "pending",
                created_at: now,
            },
        });

        const app = createApp();
        await request(app)
            .post(`/api/chat/sessions/${session.id}/permission-response`)
            .set("Authorization", `Bearer ${session.opencode_session_id}`)
            .send({
                permission_id: permission.id,
                response: "always",
            })
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.success, true);
            });

        const updatedPermission = await prisma.tool_execution_permissions.findUnique({
            where: { id: permission.id },
        });
        assert.equal(updatedPermission?.status, "approved");

        const allowlistEntry = await prisma.workflow_session_allowed_runs.findUnique({
            where: {
                opencode_session_id_workflow_slug: {
                    opencode_session_id: session.opencode_session_id,
                    workflow_slug: workflowSlug,
                },
            },
        });
        assert.ok(allowlistEntry, "Expected workflow session allowlist entry to be created");
        assert.equal(allowlistEntry?.opencode_session_id, session.opencode_session_id);
        assert.equal(allowlistEntry?.workflow_slug, workflowSlug);

        console.log("Chat workflow session allowlist route tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

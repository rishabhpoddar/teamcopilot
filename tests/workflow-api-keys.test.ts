import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-workflow-api-"));
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.TEAMCOPILOT_HOST = "127.0.0.1";
    process.env.TEAMCOPILOT_PORT = "5124";
    process.env.EXTERNAL_HOST = "///127.0.0.1:5124///";

    const workflowSlug = "api-demo";
    const workflowDir = path.join(workspaceDir, "workflows", workflowSlug);
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
        path.join(workflowDir, "workflow.json"),
        JSON.stringify({
            intent_summary: "API demo workflow",
            inputs: {
                topic: {
                    type: "string",
                    default: "weekly update",
                    description: "Topic",
                }
            },
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
                email: `workflow-api-${Date.now()}@example.com`,
                name: "Workflow API Tester",
                role: "Engineer",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });
        const chatSession = await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: `workflow-api-auth-${Date.now()}`,
                title: "Workflow API auth",
                created_at: now,
                updated_at: now,
            }
        });

        await setWorkflowCreator(workflowSlug, user.id);
        await initializeWorkflowRunPermissionsForCreator(workflowSlug, user.id);
        await approveWorkflowWithSnapshot(workflowSlug, user.id);

        const app = createApp();
        const keysResponse = await request(app)
            .get(`/api/workflows/${workflowSlug}/api-keys`)
            .set("Authorization", `Bearer ${chatSession.opencode_session_id}`)
            .expect(200);

        assert.equal(keysResponse.body.api_base_url, "http://127.0.0.1:5124/api/workflow-api");
        assert.equal(keysResponse.body.api_keys.length, 1);
        assert.match(keysResponse.body.api_keys[0].api_key, /^[0-9a-f-]{36}$/);

        await request(app)
            .delete(`/api/workflows/${workflowSlug}/api-keys/${keysResponse.body.api_keys[0].id}`)
            .set("Authorization", `Bearer ${chatSession.opencode_session_id}`)
            .expect(400);

        const secondKeyResponse = await request(app)
            .post(`/api/workflows/${workflowSlug}/api-keys`)
            .set("Authorization", `Bearer ${chatSession.opencode_session_id}`)
            .expect(200);
        assert.match(secondKeyResponse.body.api_key.api_key, /^[0-9a-f-]{36}$/);

        await request(app)
            .delete(`/api/workflows/${workflowSlug}/api-keys/${keysResponse.body.api_keys[0].id}`)
            .set("Authorization", `Bearer ${chatSession.opencode_session_id}`)
            .expect(200);

        const apiRun = await prisma.workflow_runs.create({
            data: {
                workflow_slug: workflowSlug,
                ran_by_user_id: null,
                status: "failed",
                started_at: now,
                completed_at: now,
                args: "{}",
                error_message: "Authorization: Bearer supersecretvalue",
                output: "api_key=supersecretvalue\nAuthorization: Bearer supersecretvalue\n",
                run_source: "api",
                workflow_api_key_id: secondKeyResponse.body.api_key.id,
            }
        });

        const statusResponse = await request(app)
            .get(`/api/workflow-api/runs/${apiRun.id}`)
            .set("Authorization", `Bearer ${secondKeyResponse.body.api_key.api_key}`)
            .expect(200);

        const statusJson = JSON.stringify(statusResponse.body);
        assert.equal(statusResponse.body.workflow_slug, workflowSlug);
        assert.ok(!statusJson.includes("supersecretvalue"), `Expected redacted workflow API response, got: ${statusJson}`);
        assert.ok(statusJson.includes("***"));

        await request(app)
            .get(`/api/workflow-api/runs/${apiRun.id}`)
            .set("Authorization", "Bearer invalid-key")
            .expect(401);

        console.log("Workflow API key tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

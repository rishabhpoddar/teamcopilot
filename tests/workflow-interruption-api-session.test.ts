import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-api-interruption-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { isWorkflowSessionInterrupted, markWorkflowSessionAborted } = require("../src/utils/workflow-interruption") as typeof import("../src/utils/workflow-interruption");

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
        fetchCalled = true;
        throw new Error("API workflow sessions should not query OpenCode status");
    }) as typeof fetch;

    try {
        await ensureWorkspaceDatabase();

        const sessionId = `api-test-key-${Date.now()}`;
        const beforeAbort = await isWorkflowSessionInterrupted(sessionId, workspaceDir);
        assert.equal(beforeAbort, false, "API sessions should not be interrupted without an abort marker");
        assert.equal(fetchCalled, false, "API sessions should use database abort markers instead of OpenCode status");

        await markWorkflowSessionAborted(sessionId);
        const afterAbort = await isWorkflowSessionInterrupted(sessionId, workspaceDir);
        assert.equal(afterAbort, true, "API sessions should be interrupted after an abort marker is written");

        console.log("Workflow API interruption tests passed");
    } finally {
        globalThis.fetch = originalFetch;
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

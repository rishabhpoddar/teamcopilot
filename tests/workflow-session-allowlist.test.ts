import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

type PrismaMock = {
    tool_execution_permissions: {
        create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        findUnique: (args: { where: { id: string } }) => Promise<{ status: string } | null>;
    };
};

function loadRequestWorkflowPermission(): (opencodeSessionId: string, workflowSlug: string, messageId: string, callId: string) => Promise<void> {
    const runnerPath = path.join(process.cwd(), "src", "utils", "workflow-runner.ts");
    const source = fs.readFileSync(runnerPath, "utf-8");
    const startMarker = "async function requestWorkflowPermission(";
    const endMarker = "type RunWithTimeoutResult =";
    const startIndex = source.indexOf(startMarker);
    const endIndex = source.indexOf(endMarker);

    assert.notEqual(startIndex, -1, "Failed to locate requestWorkflowPermission in src/utils/workflow-runner.ts");
    assert.notEqual(endIndex, -1, "Failed to locate RunWithTimeoutResult in src/utils/workflow-runner.ts");

    const snippet = `${source.slice(startIndex, endIndex)}\nmodule.exports = { requestWorkflowPermission };`;
    const transpiled = ts.transpileModule(snippet, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }
    }).outputText;

    const sandbox: {
        module: { exports: { requestWorkflowPermission?: (opencodeSessionId: string, workflowSlug: string, messageId: string, callId: string) => Promise<void> } };
        exports: Record<string, unknown>;
        prisma: PrismaMock;
        isWorkflowAllowedAlwaysInSession: (opencodeSessionId: string, workflowSlug: string) => Promise<boolean>;
        BigInt: typeof BigInt;
        setTimeout: typeof setTimeout;
        clearTimeout: typeof clearTimeout;
        Promise: typeof Promise;
    } = {
        module: { exports: {} },
        exports: {},
        prisma: {
            tool_execution_permissions: {
                create: async () => ({ id: "perm-1" }),
                findUnique: async () => ({ status: "approved" }),
            }
        },
        isWorkflowAllowedAlwaysInSession: async () => false,
        BigInt,
        setTimeout,
        clearTimeout,
        Promise,
    };

    vm.runInNewContext(transpiled, sandbox, { filename: "workflow-runner-request-permission.js" });
    assert.equal(typeof sandbox.module.exports.requestWorkflowPermission, "function", "Failed to load requestWorkflowPermission");
    return sandbox.module.exports.requestWorkflowPermission!;
}

async function testSkipsPendingPromptWhenWorkflowAlreadyAllowed(): Promise<void> {
    const requestWorkflowPermission = loadRequestWorkflowPermission();

    let createCalled = false;
    let allowlistChecks = 0;

    const sandbox = {
        module: { exports: {} as { requestWorkflowPermission?: typeof requestWorkflowPermission } },
        exports: {},
        prisma: {
            tool_execution_permissions: {
                create: async () => {
                    createCalled = true;
                    return { id: "perm-1" };
                },
                findUnique: async () => ({ status: "approved" }),
            }
        },
        isWorkflowAllowedAlwaysInSession: async (_sessionId: string, _workflowSlug: string) => {
            allowlistChecks += 1;
            return true;
        },
        BigInt,
        setTimeout,
        clearTimeout,
        Promise,
    };

    const runnerPath = path.join(process.cwd(), "src", "utils", "workflow-runner.ts");
    const source = fs.readFileSync(runnerPath, "utf-8");
    const startIndex = source.indexOf("async function requestWorkflowPermission(");
    const endIndex = source.indexOf("type RunWithTimeoutResult =");
    const snippet = `${source.slice(startIndex, endIndex)}\nmodule.exports = { requestWorkflowPermission };`;
    const transpiled = ts.transpileModule(snippet, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }
    }).outputText;
    vm.runInNewContext(transpiled, sandbox, { filename: "workflow-runner-request-permission-skip.js" });

    await sandbox.module.exports.requestWorkflowPermission!("session-1", "demo-workflow", "msg-1", "call-1");

    assert.equal(allowlistChecks, 1);
    assert.equal(createCalled, false, "The pending permission row should not be created when the workflow is already allowed for the session");
}

async function testCreatesWorkflowSlugOnPendingPermission(): Promise<void> {
    const requestWorkflowPermission = loadRequestWorkflowPermission();

    const createdRows: Array<Record<string, unknown>> = [];
    let findUniqueCalls = 0;
    let allowlistChecks = 0;

    const sandbox = {
        module: { exports: {} as { requestWorkflowPermission?: typeof requestWorkflowPermission } },
        exports: {},
        prisma: {
            tool_execution_permissions: {
                create: async (args: { data: Record<string, unknown> }) => {
                    createdRows.push(args.data);
                    return { id: "perm-2" };
                },
                findUnique: async () => {
                    findUniqueCalls += 1;
                    return { status: "approved" };
                },
            }
        },
        isWorkflowAllowedAlwaysInSession: async (_sessionId: string, _workflowSlug: string) => {
            allowlistChecks += 1;
            return false;
        },
        BigInt,
        setTimeout,
        clearTimeout,
        Promise,
    };

    const runnerPath = path.join(process.cwd(), "src", "utils", "workflow-runner.ts");
    const source = fs.readFileSync(runnerPath, "utf-8");
    const startIndex = source.indexOf("async function requestWorkflowPermission(");
    const endIndex = source.indexOf("type RunWithTimeoutResult =");
    const snippet = `${source.slice(startIndex, endIndex)}\nmodule.exports = { requestWorkflowPermission };`;
    const transpiled = ts.transpileModule(snippet, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }
    }).outputText;
    vm.runInNewContext(transpiled, sandbox, { filename: "workflow-runner-request-permission-create.js" });

    await sandbox.module.exports.requestWorkflowPermission!("session-2", "demo-workflow", "msg-2", "call-2");

    assert.equal(allowlistChecks, 1);
    assert.equal(findUniqueCalls, 1);
    assert.equal(createdRows.length, 1);
    assert.equal(createdRows[0]?.opencode_session_id, "session-2");
    assert.equal(createdRows[0]?.workflow_slug, "demo-workflow");
    assert.equal(createdRows[0]?.message_id, "msg-2");
    assert.equal(createdRows[0]?.call_id, "call-2");
    assert.equal(createdRows[0]?.status, "pending");
}

async function main(): Promise<void> {
    await testSkipsPendingPromptWhenWorkflowAlreadyAllowed();
    await testCreatesWorkflowSlugOnPendingPermission();
    console.log("Workflow session allowlist tests passed");
}

void main();

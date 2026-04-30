import express from "express";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "./prisma/client";
import { readWorkflowManifestAndEnsurePermissions } from "./utils/workflow";
import { getWorkflowSnapshotApprovalState } from "./utils/workflow-approval-snapshot";
import { getWorkspaceDirFromEnv } from "./utils/workspace-sync";
import { startWorkflowRunViaBackend } from "./utils/workflow-runner";
import { markWorkflowSessionAborted } from "./utils/workflow-interruption";

type WorkflowApiRequest = express.Request & {
    workflowApiKey?: {
        id: string;
        workflow_slug: string;
        api_key: string;
    };
};

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isPathInside(childPath: string, parentPath: string): boolean {
    const parent = path.resolve(parentPath) + path.sep;
    const child = path.resolve(childPath) + path.sep;
    return child.startsWith(parent);
}

function workflowApiHandler(
    handler: (req: WorkflowApiRequest, res: express.Response) => Promise<void>
) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                throw {
                    status: 401,
                    message: "Missing authorization header. Please pass the workflow API key as an authorization bearer token."
                };
            }

            const rawToken = authHeader.split(" ")[1];
            if (!rawToken) {
                throw {
                    status: 401,
                    message: "Missing authorization bearer token"
                };
            }

            const key = await prisma.workflow_api_keys.findUnique({
                where: { api_key: rawToken },
                select: { id: true, workflow_slug: true, api_key: true }
            });
            if (!key) {
                throw {
                    status: 401,
                    message: "Invalid workflow API key"
                };
            }

            const apiReq = req as WorkflowApiRequest;
            apiReq.workflowApiKey = key;
            await handler(apiReq, res);
        } catch (err) {
            next(err);
        }
    };
}

async function assertWorkflowCanRunViaApi(slug: string): Promise<void> {
    await readWorkflowManifestAndEnsurePermissions(slug);
    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: "Workflow is not approved for the current code version"
        };
    }
}

async function assertApiKeyCanAccessRun(req: WorkflowApiRequest, runHandle: string) {
    const run = await prisma.workflow_runs.findUnique({
        where: { id: runHandle }
    });
    if (!run) {
        throw {
            status: 404,
            message: "Workflow run not found"
        };
    }
    if (req.workflowApiKey!.workflow_slug !== run.workflow_slug) {
        throw {
            status: 403,
            message: "Workflow API key does not have access to this run"
        };
    }
    return run;
}

async function readWorkflowRunLogs(run: { session_id: string | null; message_id: string | null }): Promise<string | null> {
    if (!run.session_id || !run.message_id) {
        return null;
    }

    const workspaceDir = getWorkspaceDirFromEnv();
    const workflowRunsDir = path.join(workspaceDir, "workflow-runs");
    const logPath = path.join(
        workflowRunsDir,
        `${sanitizeFilenamePart(run.session_id)}-${sanitizeFilenamePart(run.message_id)}.txt`
    );

    if (!isPathInside(logPath, workflowRunsDir)) {
        throw {
            status: 400,
            message: "Invalid log path"
        };
    }

    try {
        return await fsPromises.readFile(logPath, "utf-8");
    } catch {
        return null;
    }
}

function parseRunInputs(args: string | null): Record<string, unknown> {
    if (args === null || args === "") {
        return {};
    }
    return JSON.parse(args) as Record<string, unknown>;
}

const workflowApiRouter = express.Router();

workflowApiRouter.post("/runs", workflowApiHandler(async (req, res) => {
    const body = req.body as { workflow_slug?: unknown; inputs?: unknown };
    if (typeof body.workflow_slug !== "string" || body.workflow_slug.trim().length === 0) {
        throw {
            status: 400,
            message: "workflow_slug is required"
        };
    }
    if (body.inputs !== undefined && (!body.inputs || typeof body.inputs !== "object" || Array.isArray(body.inputs))) {
        throw {
            status: 400,
            message: "inputs must be an object"
        };
    }

    const slug = body.workflow_slug;
    if (req.workflowApiKey!.workflow_slug !== slug) {
        throw {
            status: 403,
            message: "Workflow API key does not belong to this workflow"
        };
    }

    await assertWorkflowCanRunViaApi(slug);

    const startedRun = await startWorkflowRunViaBackend({
        workspaceDir: getWorkspaceDirFromEnv(),
        slug,
        inputs: (body.inputs ?? {}) as Record<string, unknown>,
        authUserId: null,
        sessionId: `api-${req.workflowApiKey!.id}-${randomUUID()}`,
        messageId: `api-message-${randomUUID()}`,
        callId: `api-call-${randomUUID()}`,
        requirePermissionPrompt: false,
        secretResolutionMode: "global",
        runSource: "api",
        workflowApiKeyId: req.workflowApiKey!.id,
    });

    void startedRun.completion.catch(() => undefined);

    res.json({
        run_handle: startedRun.runId
    });
}));

workflowApiRouter.get("/runs/:runHandle", workflowApiHandler(async (req, res) => {
    const runHandle = req.params.runHandle as string;
    const run = await assertApiKeyCanAccessRun(req, runHandle);
    const logs = await readWorkflowRunLogs(run);
    const inputs = parseRunInputs(run.args);

    res.json({
        run_handle: run.id,
        workflow_slug: run.workflow_slug,
        status: run.status,
        logs,
        error_message: run.error_message,
        started_at: run.started_at,
        completed_at: run.completed_at,
        inputs,
    });
}));

workflowApiRouter.post("/runs/:runHandle/stop", workflowApiHandler(async (req, res) => {
    const runHandle = req.params.runHandle as string;
    const run = await assertApiKeyCanAccessRun(req, runHandle);

    if (run.status === "running") {
        if (!run.session_id) {
            throw {
                status: 404,
                message: "Workflow run session not found"
            };
        }
        await markWorkflowSessionAborted(run.session_id);
    }

    res.json({ success: true });
}));

export default workflowApiRouter;

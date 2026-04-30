import express from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import prisma from "../prisma/client";
import { WorkflowManifest, WorkflowMetadata, WorkflowSummary } from "../types/workflow";
import { EditorAccessResponse } from "../types/workflow-files";
import { apiHandler } from "../utils/index";
import {
    listWorkflowSlugs,
    readWorkflowManifestAndEnsurePermissions,
    setWorkflowCreator,
    deleteWorkflow
} from "../utils/workflow";
import {
    createWorkflowFileOrFolder,
    deleteWorkflowPath,
    listWorkflowDirectory,
    readWorkflowFileContent,
    renameWorkflowPath,
    saveWorkflowFileContent,
    uploadWorkflowFileFromTempPath,
} from "../utils/workflow-files";
import {
    addApproverToWorkflowRunPermissionsIfRestricted,
    getWorkflowRunPermissionWithUsers,
    setWorkflowRunPermissions,
    initializeWorkflowRunPermissionsForCreator,
} from "../utils/workflow-permissions";
import { assertCommonPermissionMode } from "../utils/permission-common";
import {
    approveWorkflowWithSnapshot,
    buildApprovalDiffResponse,
    collectCurrentWorkflowSnapshot,
    getWorkflowSnapshotApprovalState,
    loadApprovedSnapshotFromDb,
    restoreWorkflowToApprovedSnapshot,
} from "../utils/workflow-approval-snapshot";
import { getWorkspaceDirFromEnv } from "../utils/workspace-sync";
import { startWorkflowRunViaBackend } from "../utils/workflow-runner";
import { isWorkflowSessionInterrupted, markWorkflowSessionAborted } from "../utils/workflow-interruption";
import { abortOpencodeSession } from "../utils/session-abort";
import { registerResourceFileRoutes } from "../utils/resource-file-routes";
import { getResourceAccessSummary } from "../utils/resource-access";
import { listResolvedSecretsForUser, resolveSecretsForUser, resolveSecretsFromResolvedMap } from "../utils/secrets";
import { validateWorkflowFilesAtPath } from "../utils/secret-contract-validation";
import {
    assertCanManageWorkflowApiKeys,
    createWorkflowApiKey,
    deleteWorkflowApiKey,
    listWorkflowApiKeys,
} from "../utils/workflow-api-keys";
import { getWorkflowApiBaseUrl } from "../utils/workflow-api-config";

const router = express.Router({ mergeParams: true });

const uploadTmpDir = path.join(os.tmpdir(), "teamcopilot-workflow-uploads");
fs.mkdirSync(uploadTmpDir, { recursive: true });
const maxUploadBytes = (() => {
    const parsed = Number(process.env.WORKFLOW_FILE_UPLOAD_MAX_MB ?? "1024");
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1024 * 1024 * 1024;
    }
    return Math.floor(parsed * 1024 * 1024);
})();
const workflowFileUpload = multer({
    dest: uploadTmpDir,
    limits: {
        files: 1,
        fileSize: maxUploadBytes,
    },
});

function isPathInside(childPath: string, parentPath: string): boolean {
    const parent = path.resolve(parentPath) + path.sep;
    const child = path.resolve(childPath) + path.sep;
    return child.startsWith(parent);
}

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function assertCurrentUserCanRunWorkflow(slug: string, userId: string): Promise<void> {
    await readWorkflowManifestAndEnsurePermissions(slug);
    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: 'Workflow is not approved for the current code version'
        };
    }

    const permissionSummary = await getResourceAccessSummary("workflow", slug, userId);
    if (!permissionSummary.can_edit) {
        throw {
            status: 403,
            message: permissionSummary.is_locked_due_to_missing_users
                ? 'Workflow cannot be run because no allowed users remain'
                : 'You do not have permission to run this workflow. Please contact the workflow owner to request permission.'
        };
    }
}

async function getWorkflowEditorAccess(slug: string, userId: string): Promise<EditorAccessResponse> {
    const accessSummary = await getResourceAccessSummary("workflow", slug, userId);
    const workflowStatus = accessSummary.is_approved ? "approved" : "pending";

    return {
        can_view: accessSummary.can_view,
        can_edit: accessSummary.can_edit,
        editor_status: workflowStatus,
    };
}

async function assertCanEditWorkflowFiles(slug: string, userId: string): Promise<void> {
    const access = await getWorkflowEditorAccess(slug, userId);
    if (!access.can_edit) {
        throw {
            status: 403,
            message: "You do not have permission to edit this workflow"
        };
    }
}

async function assertCanViewWorkflowFiles(slug: string, userId: string): Promise<void> {
    const access = await getWorkflowEditorAccess(slug, userId);
    if (!access.can_view) {
        throw {
            status: 403,
            message: "You do not have permission to view this workflow"
        };
    }
}

type WorkflowExecutionStatus = "running" | "success" | "error" | "timeout" | "aborted";

type WorkflowExecutionRecord = {
    slug: string;
    runId: string;
    timeoutSeconds: number;
    status: WorkflowExecutionStatus;
    output: string | null;
    errorMessage: string | null;
};

const workflowExecutions = new Map<string, WorkflowExecutionRecord>();

// GET /api/workflows - List available workflows from filesystem
router.get('/', apiHandler(async (req, res) => {
    const slugs = listWorkflowSlugs();
    const workflows: WorkflowSummary[] = [];
    const creatorIds = new Set<string>();
    const manifests = new Map<string, WorkflowManifest>();
    const metadataBySlug = new Map<string, WorkflowMetadata>();
    const resolvedSecrets = await listResolvedSecretsForUser(req.userId!);

    for (const slug of slugs) {
        const { manifest, metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
        manifests.set(slug, manifest);
        metadataBySlug.set(slug, metadata);
        if (metadata.created_by_user_id) {
            creatorIds.add(metadata.created_by_user_id);
        }
    }

    const creators = creatorIds.size > 0
        ? await prisma.users.findMany({
            where: { id: { in: Array.from(creatorIds) } },
            select: { id: true, name: true, email: true }
        })
        : [];
    const creatorNameById = new Map(creators.map((creator) => [creator.id, creator.name]));
    const creatorEmailById = new Map(creators.map((creator) => [creator.id, creator.email]));

    for (const slug of slugs) {
        const manifest = manifests.get(slug);
        const metadata = metadataBySlug.get(slug);
        if (!manifest) continue;
        if (!metadata) continue;
        const accessSummary = await getResourceAccessSummary("workflow", slug, req.userId!);
        if (!accessSummary.can_view) {
            continue;
        }
        const createdByUserId = metadata.created_by_user_id;
        workflows.push({
            slug,
            name: slug,
            intent_summary: manifest.intent_summary,
            created_by_user_id: createdByUserId,
            created_by_user_name: createdByUserId ? (creatorNameById.get(createdByUserId) ?? null) : null,
            created_by_user_email: createdByUserId ? (creatorEmailById.get(createdByUserId) ?? null) : null,
            approved_by_user_id: metadata.approved_by_user_id ?? null,
            is_approved: accessSummary.is_approved,
            can_view: accessSummary.can_view,
            can_edit: accessSummary.can_edit,
            permission_mode: accessSummary.permission_mode,
            is_locked_due_to_missing_users: accessSummary.is_locked_due_to_missing_users,
            required_secrets: manifest.required_secrets ?? [],
            missing_required_secrets: resolveSecretsFromResolvedMap(resolvedSecrets, manifest.required_secrets ?? []).missingKeys,
        });
    }

    res.json({ workflows });
}, true));

// GET /api/workflows/runs - List workflow run history (last 50, all users)
router.get('/runs', apiHandler(async (_req, res) => {
    const runs = await prisma.workflow_runs.findMany({
        orderBy: { started_at: 'desc' },
        take: 50,
        include: {
            user: {
                select: { name: true, email: true }
            }
        }
    });

    res.json({ runs });
}, true));

// GET /api/workflows/runs/logs - Get log file by run_id OR session_id+message_id
router.get('/runs/logs', apiHandler(async (req, res) => {
    const runIdRaw = req.query.run_id;
    const sessionIdRaw = req.query.session_id;
    const messageIdRaw = req.query.message_id;

    const runId = typeof runIdRaw === 'string' && runIdRaw.trim().length > 0 ? runIdRaw : null;
    const sessionId = typeof sessionIdRaw === 'string' && sessionIdRaw.trim().length > 0 ? sessionIdRaw : null;
    const messageId = typeof messageIdRaw === 'string' && messageIdRaw.trim().length > 0 ? messageIdRaw : null;

    if (!runId && !(sessionId && messageId)) {
        throw {
            status: 400,
            message: 'Provide either run_id, or both session_id and message_id'
        };
    }

    if (runId && (sessionId || messageId)) {
        throw {
            status: 400,
            message: 'Provide either run_id, or session_id + message_id, not both'
        };
    }

    const run = runId
        ? await prisma.workflow_runs.findUnique({
            where: { id: runId },
            select: { session_id: true, message_id: true }
        })
        : await prisma.workflow_runs.findFirst({
            where: {
                session_id: sessionId!,
                message_id: messageId!,
            },
            select: { session_id: true, message_id: true },
            orderBy: { started_at: 'desc' }
        });

    if (!run?.session_id || !run.message_id) {
        res.json({
            found: false,
            logs: null
        });
        return;
    }

    const workspaceDir = getWorkspaceDirFromEnv();
    const workflowRunsDir = path.join(workspaceDir, 'workflow-runs');
    const logPath = path.join(
        workflowRunsDir,
        `${sanitizeFilenamePart(run.session_id)}-${sanitizeFilenamePart(run.message_id)}.txt`
    );

    if (!isPathInside(logPath, workflowRunsDir)) {
        throw {
            status: 400,
            message: 'Invalid log path'
        };
    }

    try {
        const logs = await fsPromises.readFile(logPath, 'utf-8');
        res.json({
            found: true,
            logs
        });
    } catch {
        res.json({
            found: false,
            logs: null
        });
    }
}, true));

// GET /api/workflows/runs/:id - Get details for a specific workflow run
router.get('/runs/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const run = await prisma.workflow_runs.findUnique({
        where: { id },
        include: {
            user: {
                select: { name: true, email: true }
            }
        }
    });

    if (!run) {
        throw {
            status: 404,
            message: 'Workflow run not found'
        };
    }

    res.json({ run });
}, true));

// GET /api/workflows/interruption-status/:sessionId - Check if a workflow session should stop
router.get('/interruption-status/:sessionId', apiHandler(async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const workspaceDir = getWorkspaceDirFromEnv();
    const interrupted = await isWorkflowSessionInterrupted(sessionId, workspaceDir);
    res.json({ interrupted });
}, true));

// POST /api/workflows/runs/:id/stop - Stop an in-progress workflow run
router.post('/runs/:id/stop', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const run = await prisma.workflow_runs.findUnique({
        where: { id }
    });

    if (!run) {
        throw {
            status: 404,
            message: 'Workflow run not found'
        };
    }

    if (run.status !== 'running') {
        res.json({ success: true });
        return;
    }

    const permissionSummary = await getResourceAccessSummary("workflow", run.workflow_slug, req.userId!);
    if (!permissionSummary.can_edit) {
        throw {
            status: 403,
            message: 'You do not have permission to stop this workflow run'
        };
    }

    if (!run.session_id) {
        throw {
            status: 404,
            message: 'Workflow run session not found'
        };
    }
    const isManualSession = run.session_id.startsWith("manual-");
    if (isManualSession) {
        await markWorkflowSessionAborted(run.session_id);
    } else {
        await abortOpencodeSession(run.session_id);
    }

    res.json({ success: true });
}, true));

// POST /api/workflows/:slug/manual-run - Start a workflow run from manual mode UI
router.post('/:slug/manual-run', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const inputsRaw = (req.body as { inputs?: unknown }).inputs ?? {};
    if (!inputsRaw || typeof inputsRaw !== 'object' || Array.isArray(inputsRaw)) {
        throw {
            status: 400,
            message: 'inputs must be an object'
        };
    }
    const inputs = inputsRaw as Record<string, unknown>;
    const manualSessionId = `manual-${req.userId!}-${randomUUID()}`;
    const manualMessageId = `manual-message-${randomUUID()}`;
    const manualCallId = `manual-call-${randomUUID()}`;
    const workspaceDir = getWorkspaceDirFromEnv();
    await assertCurrentUserCanRunWorkflow(slug, req.userId!);

    const startedRun = await startWorkflowRunViaBackend({
        workspaceDir,
        slug,
        inputs,
        authUserId: req.userId!,
        sessionId: manualSessionId,
        messageId: manualMessageId,
        callId: manualCallId,
        requirePermissionPrompt: false,
        runSource: "user",
    });

    void startedRun.completion.catch(() => undefined);

    res.json({
        run_id: startedRun.runId
    });
}, true));

// POST /api/workflows/execute - Start workflow execution without blocking on completion.
router.post('/execute', apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: 'This endpoint requires an opencode session token'
        };
    }

    const body = req.body as {
        slug: string;
        inputs: Record<string, unknown>;
        message_id: string;
        call_id: string;
    };
    if (typeof body.slug !== "string") {
        throw { status: 400, message: "slug is required" };
    }
    if (typeof body.message_id !== "string") {
        throw { status: 400, message: "message_id is required" };
    }
    if (typeof body.call_id !== "string") {
        throw { status: 400, message: "call_id is required" };
    }
    const slug = body.slug;
    const inputs = body.inputs ?? {};
    const messageId = body.message_id;
    const callId = body.call_id;
    const workspaceDir = getWorkspaceDirFromEnv();
    await assertCurrentUserCanRunWorkflow(slug, req.userId!);
    const startedRun = await startWorkflowRunViaBackend({
        workspaceDir,
        slug,
        inputs,
        authUserId: req.userId!,
        sessionId: req.opencode_session_id,
        messageId,
        callId,
        requirePermissionPrompt: true,
        runSource: "user",
    });

    const executionId = randomUUID();
    const executionRecord: WorkflowExecutionRecord = {
        slug,
        runId: startedRun.runId,
        timeoutSeconds: startedRun.timeoutSeconds,
        status: "running",
        output: null,
        errorMessage: null,
    };

    workflowExecutions.set(executionId, executionRecord);
    void startedRun.completion
        .then((result) => {
            executionRecord.output = result.output;
            executionRecord.status = result.status as WorkflowExecutionStatus;
            executionRecord.errorMessage = result.status === "success" ? null : `Workflow execution ${result.status}`;
        })
        .catch((err) => {
            const errorOutput = err instanceof Error ? err.message : JSON.stringify(err);
            executionRecord.status = "error";
            executionRecord.errorMessage = errorOutput;
            executionRecord.output = errorOutput;
        });

    res.json({
        execution_id: executionId,
        status: "running",
    });
}, true));

// GET /api/workflows/execute/:executionId - Get execution status/result.
router.get('/execute/:executionId', apiHandler(async (req, res) => {
    const executionId = req.params.executionId as string;
    const execution = workflowExecutions.get(executionId);
    if (!execution) {
        throw {
            status: 404,
            message: 'Execution not found'
        };
    }

    if (execution.status === "running") {
        res.json({
            execution_id: executionId,
            status: "running" as const,
        });
        return;
    }

    const responsePayload = {
        status: execution.status,
        output: execution.output,
        workflow: execution.slug,
        timeout_seconds: execution.timeoutSeconds,
        run_id: execution.runId,
    };

    workflowExecutions.delete(executionId);

    if (execution.status !== "success") {
        throw {
            status: 500,
            message: "Workflow execution failed: " + JSON.stringify(responsePayload),
            doLogging: false,
            maskErrorMessage: false,
        };
    }

    res.json(responsePayload);
}, true));

// PATCH /api/workflows/runs/:id - Update run status
router.patch('/runs/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const { status, error_message, output } = req.body;

    if (!status || !['running', 'success', 'failed'].includes(status)) {
        throw {
            status: 400,
            message: 'status must be "running", "success", or "failed"'
        };
    }

    const existingRun = await prisma.workflow_runs.findUnique({ where: { id } });
    if (!existingRun) {
        throw {
            status: 404,
            message: 'Workflow run not found'
        };
    }

    if (existingRun.status !== 'running') {
        throw {
            status: 400,
            message: 'Can only update runs that are in running status'
        };
    }

    const updateData: { status: string; completed_at?: bigint; error_message?: string; output?: string } = { status };

    if (status === 'success' || status === 'failed') {
        updateData.completed_at = BigInt(Date.now());
    }

    if (status === 'failed' && error_message) {
        updateData.error_message = error_message;
    }

    if (output) {
        updateData.output = output;
    }

    const run = await prisma.workflow_runs.update({
        where: { id },
        data: updateData
    });

    res.json({ run });
}, true));

// POST /api/workflows/:slug/approve - Approve a workflow
router.post('/:slug/approve', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;

    const approvalResult = await approveWorkflowWithSnapshot(slug, req.userId!);
    const { metadata: approvedMetadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    await addApproverToWorkflowRunPermissionsIfRestricted(slug, req.userId!, approvedMetadata.created_by_user_id);

    res.json({
        workflow: {
            slug,
            approved_by_user_id: approvalResult.approved_by_user_id,
            is_approved: true,
            snapshot_hash: approvalResult.snapshot_hash,
            snapshot_file_count: approvalResult.snapshot_file_count
        }
    });
}, true));

// POST /api/workflows/:slug/reject-restore - Restore workflow files to last approved snapshot
router.post('/:slug/reject-restore', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const result = await restoreWorkflowToApprovedSnapshot(slug, req.userId!);
    res.json({
        workflow: {
            slug,
            restored_file_count: result.restored_file_count,
            snapshot_hash: result.snapshot_hash,
        }
    });
}, true));

// POST /api/workflows/:slug/creator - Set the creator user id for a workflow
router.post('/:slug/creator', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const { metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    const existingCreator = metadata.created_by_user_id ?? null;

    if (existingCreator && existingCreator !== req.userId!) {
        throw {
            status: 409,
            message: 'Workflow creator is already set and cannot be changed'
        };
    }

    const updatedMetadata = existingCreator
        ? metadata
        : await setWorkflowCreator(slug, req.userId!);
    validateWorkflowFilesAtPath(path.join(getWorkspaceDirFromEnv(), "workflows", slug));
    await initializeWorkflowRunPermissionsForCreator(slug, req.userId!);

    res.json({
        workflow: {
            slug,
            created_by_user_id: updatedMetadata.created_by_user_id
        }
    });
}, true));

// DELETE /api/workflows/:slug - Delete workflow directory and all past runs
router.delete('/:slug', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const { metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    const creatorUserId = metadata.created_by_user_id ?? null;

    const creator = creatorUserId
        ? await prisma.users.findUnique({
            where: { id: creatorUserId },
            select: { id: true }
        })
        : null;

    const isOwner = creatorUserId === req.userId!;
    const hasNoCreatorUser = creator === null;
    const isEngineer = req.role === 'Engineer';

    if (!isOwner && !(hasNoCreatorUser && isEngineer)) {
        throw {
            status: 403,
            message: 'Only the workflow owner can delete this workflow. Engineers can only delete workflows whose owner no longer exists.'
        };
    }

    await deleteWorkflow(slug);

    res.json({ success: true });
}, true));

// GET /api/workflows/:slug/api-keys - List API keys for an approved workflow
router.get('/:slug/api-keys', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanManageWorkflowApiKeys(slug, req.userId!);
    const apiKeys = await listWorkflowApiKeys(slug, req.userId!);

    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json({
        api_base_url: getWorkflowApiBaseUrl(),
        api_keys: apiKeys,
    });
}, true));

// POST /api/workflows/:slug/api-keys - Add an API key for an approved workflow
router.post('/:slug/api-keys', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanManageWorkflowApiKeys(slug, req.userId!);
    const apiKey = await createWorkflowApiKey(slug, req.userId!);

    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json({
        api_key: apiKey,
    });
}, true));

// DELETE /api/workflows/:slug/api-keys/:keyId - Remove an API key
router.delete('/:slug/api-keys/:keyId', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const keyId = req.params.keyId as string;
    await assertCanManageWorkflowApiKeys(slug, req.userId!);
    await deleteWorkflowApiKey(slug, keyId);

    res.json({ success: true });
}, true));

// GET /api/workflows/:slug/approval-diff - Preview current code diff vs approved snapshot
router.get('/:slug/approval-diff', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;

    if (req.role !== 'Engineer') {
        throw {
            status: 403,
            message: 'Only Engineers can review approval diffs'
        };
    }

    await readWorkflowManifestAndEnsurePermissions(slug);
    const previousSnapshot = await loadApprovedSnapshotFromDb(slug);
    const currentSnapshot = collectCurrentWorkflowSnapshot(slug);
    const diff = buildApprovalDiffResponse(previousSnapshot, currentSnapshot);
    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json(diff);
}, true));

registerResourceFileRoutes({
    router,
    uploadMiddleware: workflowFileUpload.single("file"),
    assertCanView: assertCanViewWorkflowFiles,
    ensureResourceExists: async (slug: string) => {
        await readWorkflowManifestAndEnsurePermissions(slug);
    },
    getEditorAccess: getWorkflowEditorAccess,
    assertCanEdit: assertCanEditWorkflowFiles,
    listDirectory: listWorkflowDirectory,
    readFileContent: readWorkflowFileContent,
    saveFileContent: saveWorkflowFileContent,
    createFileOrFolder: createWorkflowFileOrFolder,
    uploadFileFromTempPath: uploadWorkflowFileFromTempPath,
    renamePath: renameWorkflowPath,
    deletePath: deleteWorkflowPath,
});

// GET /api/workflows/:slug - Get workflow details from filesystem
router.get('/:slug', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanViewWorkflowFiles(slug, req.userId!);
    const { manifest, metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    const permission = await getWorkflowRunPermissionWithUsers(slug);
    const accessSummary = await getResourceAccessSummary("workflow", slug, req.userId!);
    const secretResolution = await resolveSecretsForUser(req.userId!, manifest.required_secrets ?? []);

    const createdByUserId = metadata.created_by_user_id ?? null;
    const approvedByUserId = metadata.approved_by_user_id ?? null;
    const userIds = [createdByUserId, approvedByUserId].filter((id): id is string => typeof id === "string");
    const users = userIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true }
        })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const creator = createdByUserId ? (usersById.get(createdByUserId) ?? null) : null;
    const approver = approvedByUserId ? (usersById.get(approvedByUserId) ?? null) : null;
    const permissionMode = assertCommonPermissionMode(permission.permission_mode, "workflow run");
    const permissions = permissionMode === "everyone"
        ? { mode: "everyone" as const }
        : { mode: "restricted" as const, allowed_user_ids: permission.allowedUsers.map((row) => row.user_id) };
    res.json({
        workflow: {
            slug,
            name: slug,
            intent_summary: manifest.intent_summary,
            created_by_user_id: createdByUserId,
            created_by_user_name: creator?.name ?? null,
            created_by_user_email: creator?.email ?? null,
            approved_by_user_id: approvedByUserId,
            is_approved: accessSummary.is_approved,
            approved_by_user_name: approver?.name ?? null,
            approved_by_user_email: approver?.email ?? null,
            can_view: accessSummary.can_view,
            can_edit: accessSummary.can_edit,
            permission_mode: accessSummary.permission_mode,
            is_locked_due_to_missing_users: accessSummary.is_locked_due_to_missing_users,
            required_secrets: manifest.required_secrets ?? [],
            missing_required_secrets: secretResolution.missingKeys,
            permissions,
            allowed_users_resolved: permission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            })),
            manifest
        }
    });
}, true));

const updateWorkflowPermissionsHandler = apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const { metadata } = await readWorkflowManifestAndEnsurePermissions(slug);

    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: 'Workflow must be approved before updating run permissions'
        };
    }

    const currentSummary = await getResourceAccessSummary("workflow", slug, req.userId!);
    if (!currentSummary.can_edit) {
        throw {
            status: 403,
            message: currentSummary.is_locked_due_to_missing_users
                ? 'Workflow permissions cannot be modified because no allowed users remain'
                : 'You do not have permission to modify workflow run permissions'
        };
    }

    const { mode, allowed_user_ids } = req.body as { mode?: string; allowed_user_ids?: unknown };
    if (mode !== 'restricted' && mode !== 'everyone') {
        throw {
            status: 400,
            message: 'mode must be "restricted" or "everyone"'
        };
    }

    const updatedPermission = mode === 'everyone'
        ? await setWorkflowRunPermissions(slug, { mode: 'everyone' }, metadata.created_by_user_id)
        : await setWorkflowRunPermissions(slug, {
            mode: 'restricted',
            allowed_user_ids: Array.isArray(allowed_user_ids) ? allowed_user_ids.map((id) => String(id)) : []
        }, metadata.created_by_user_id);
    const updatedSummary = await getResourceAccessSummary("workflow", slug, req.userId!);
    const updatedPermissionMode = assertCommonPermissionMode(updatedPermission.permission_mode, "workflow run");
    const permissions = updatedPermissionMode === "everyone"
        ? { mode: "everyone" as const }
        : { mode: "restricted" as const, allowed_user_ids: updatedPermission.allowedUsers.map((row) => row.user_id) };

    res.json({
        workflow: {
            slug,
            ...updatedSummary,
            permissions,
            allowed_users_resolved: updatedPermission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            }))
        }
    });
}, true);

// PATCH /api/workflows/:slug/permissions - Update permissions (canonical)
router.patch('/:slug/permissions', updateWorkflowPermissionsHandler);

// POST /api/workflows/request-permission - Create a tool execution permission request
router.post('/request-permission', apiHandler(async (req, res) => {
    const { message_id, call_id } = req.body;

    if (!message_id || !call_id) {
        throw {
            status: 400,
            message: 'opencode_session_id, message_id, and call_id are required'
        };
    }

    // Create or update permission request in database
    const permission = await prisma.tool_execution_permissions.upsert({
        where: {
            opencode_session_id_message_id_call_id: {
                opencode_session_id: req.opencode_session_id!,
                message_id,
                call_id
            }
        },
        create: {
            opencode_session_id: req.opencode_session_id!,
            message_id,
            call_id,
            status: 'pending',
            created_at: BigInt(Date.now())
        },
        update: {
            status: 'pending',
            responded_at: null
        }
    });

    res.json({ permission_id: permission.id });
}, true)); // Plugin authenticates with opencode session token

// GET /api/workflows/permission-status/:id - Check permission status
router.get('/permission-status/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const permission = await prisma.tool_execution_permissions.findUnique({
        where: { id }
    });

    if (!permission) {
        throw {
            status: 404,
            message: 'Permission request not found'
        };
    }
    if (req.opencode_session_id! !== permission.opencode_session_id) {
        throw {
            status: 403,
            message: 'Authorization token does not match permission session'
        };
    }

    res.json({
        status: permission.status,
        approved: permission.status === 'approved'
    });
}, true)); // Plugin authenticates with opencode session token

// POST /api/workflows/permission-reject/:id - Reject a pending permission request (plugin cleanup)
router.post('/permission-reject/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const permission = await prisma.tool_execution_permissions.findUnique({
        where: { id }
    });

    if (!permission) {
        throw {
            status: 404,
            message: 'Permission request not found'
        };
    }
    if (req.opencode_session_id! !== permission.opencode_session_id) {
        throw {
            status: 403,
            message: 'Authorization token does not match permission session'
        };
    }

    if (permission.status === 'pending') {
        await prisma.tool_execution_permissions.update({
            where: { id },
            data: {
                status: 'rejected',
                responded_at: BigInt(Date.now())
            }
        });
    }

    res.json({ success: true });
}, true)); // Plugin authenticates with opencode session token

export default router;

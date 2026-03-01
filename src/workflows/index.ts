import express from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import prisma from "../prisma/client";
import { WorkflowManifest, WorkflowMetadata, WorkflowSummary } from "../types/workflow";
import { WorkflowEditorAccessResponse } from "../types/workflow-files";
import { apiHandler } from "../utils/index";
import {
    listWorkflowSlugs,
    readWorkflowManifestAndEnsurePermissions,
    setWorkflowCreator,
    deleteWorkflowDirectory
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
    getPermissionSummaryFields,
    getWorkflowRunPermissionWithUsers,
    mapPermissionToApi,
    setWorkflowRunPermissions,
    initializeWorkflowRunPermissionsForCreator,
} from "../utils/workflow-permissions";
import {
    approveWorkflowWithSnapshot,
    buildApprovalDiffResponse,
    collectCurrentWorkflowSnapshot,
    ensureWorkflowMatchesApprovedSnapshotForRun,
    getWorkflowSnapshotApprovalState,
    loadApprovedSnapshotFromDb,
    restoreWorkflowToApprovedSnapshot,
} from "../utils/workflow-approval-snapshot";
import { getWorkspaceDirFromEnv } from "../utils/workspace-sync";
import { startWorkflowRunViaBackend } from "../utils/workflow-runner";
import { isWorkflowSessionInterrupted, markWorkflowSessionAborted } from "../utils/workflow-interruption";
import { abortOpencodeSession } from "../utils/session-abort";

const router = express.Router({ mergeParams: true });

const uploadTmpDir = path.join(os.tmpdir(), "localtool-workflow-uploads");
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

    const permission = await getWorkflowRunPermissionWithUsers(slug);
    const permissionSummary = getPermissionSummaryFields(permission, userId);
    if (!permissionSummary.can_current_user_run) {
        throw {
            status: 403,
            message: permissionSummary.is_run_locked_due_to_missing_users
                ? 'Workflow cannot be run because no allowed users remain'
                : 'You do not have permission to run this workflow. Please contact the workflow owner to request permission.'
        };
    }

    await ensureWorkflowMatchesApprovedSnapshotForRun(slug);
}

async function getWorkflowEditorAccess(slug: string, userId: string, role: string | undefined): Promise<WorkflowEditorAccessResponse> {
    const { metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    const isOwner = metadata.created_by_user_id === userId;
    const isEngineer = role === "Engineer";
    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    const workflowStatus = approvalState.is_current_code_approved ? "approved" : "pending";

    let canEdit = false;
    if (workflowStatus === "approved") {
        const permission = await getWorkflowRunPermissionWithUsers(slug);
        const permissionSummary = getPermissionSummaryFields(permission, userId);
        canEdit = permissionSummary.can_current_user_run;
    } else {
        canEdit = isOwner || isEngineer;
    }

    return {
        can_view: true,
        can_edit: canEdit,
        workflow_status: workflowStatus,
    };
}

async function assertCanEditWorkflowFiles(slug: string, userId: string, role: string | undefined): Promise<void> {
    const access = await getWorkflowEditorAccess(slug, userId, role);
    if (!access.can_edit) {
        throw {
            status: 403,
            message: "You do not have permission to edit this workflow"
        };
    }
}

// GET /api/workflows - List available workflows from filesystem
router.get('/', apiHandler(async (req, res) => {
    const slugs = listWorkflowSlugs();
    const workflows: WorkflowSummary[] = [];
    const creatorIds = new Set<string>();
    const manifests = new Map<string, WorkflowManifest>();
    const metadataBySlug = new Map<string, WorkflowMetadata>();

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
        const permission = await getWorkflowRunPermissionWithUsers(slug);
        const permissionSummary = getPermissionSummaryFields(permission, req.userId!);
        const approvalState = await getWorkflowSnapshotApprovalState(slug);
        const createdByUserId = metadata.created_by_user_id ?? null;
        workflows.push({
            slug,
            name: slug,
            intent_summary: manifest.intent_summary,
            created_by_user_id: createdByUserId,
            created_by_user_name: createdByUserId ? (creatorNameById.get(createdByUserId) ?? null) : null,
            created_by_user_email: createdByUserId ? (creatorEmailById.get(createdByUserId) ?? null) : null,
            approved_by_user_id: metadata.approved_by_user_id ?? null,
            is_approved: approvalState.is_current_code_approved,
            ...permissionSummary
        });
    }

    res.json({ workflows });
}, true));

// GET /api/workflows/runs - List workflow run history (last 50, all users)
router.get('/runs', apiHandler(async (req, res) => {
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

    const runLogRef = runId
        ? await prisma.workflow_run_log_refs.findUnique({
            where: { run_id: runId }
        })
        : await prisma.workflow_run_log_refs.findFirst({
            where: {
                session_id: sessionId!,
                message_id: messageId!,
            },
            orderBy: { created_at: 'desc' }
        });

    if (!runLogRef) {
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
        `${sanitizeFilenamePart(runLogRef.session_id)}-${sanitizeFilenamePart(runLogRef.message_id)}.txt`
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

    const isOwner = run.ran_by_user_id === req.userId!;
    const isEngineer = req.role === "Engineer";
    if (!isOwner && !isEngineer) {
        const permission = await getWorkflowRunPermissionWithUsers(run.workflow_slug);
        const permissionSummary = getPermissionSummaryFields(permission, req.userId!);
        if (!permissionSummary.can_current_user_run) {
            throw {
                status: 403,
                message: 'You do not have permission to stop this workflow run'
            };
        }
    }

    const runLogRef = await prisma.workflow_run_log_refs.findUnique({
        where: { run_id: id }
    });
    if (!runLogRef) {
        throw {
            status: 404,
            message: 'Workflow run log mapping not found'
        };
    }
    const isManualSession = runLogRef.session_id.startsWith("manual-");
    if (isManualSession) {
        await markWorkflowSessionAborted(runLogRef.session_id);
    } else {
        await abortOpencodeSession(runLogRef.session_id);
    }

    res.json({ success: true });
}, true));

// POST /api/workflows/runs - Create new workflow run record
router.post('/runs', apiHandler(async (req, res) => {
    const { workflow_slug, session_id, message_id, args } = req.body as {
        workflow_slug?: unknown;
        session_id?: unknown;
        message_id?: unknown;
        args?: unknown;
    };

    if (typeof workflow_slug !== 'string' || workflow_slug.trim().length === 0) {
        throw {
            status: 400,
            message: 'workflow_slug is required'
        };
    }

    if (typeof session_id !== 'string' || session_id.trim().length === 0) {
        throw {
            status: 400,
            message: 'session_id is required'
        };
    }

    if (typeof message_id !== 'string' || message_id.trim().length === 0) {
        throw {
            status: 400,
            message: 'message_id is required'
        };
    }

    await readWorkflowManifestAndEnsurePermissions(workflow_slug);

    const approvalState = await getWorkflowSnapshotApprovalState(workflow_slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: 'Workflow is not approved for the current code version'
        };
    }

    const permission = await getWorkflowRunPermissionWithUsers(workflow_slug);
    const permissionSummary = getPermissionSummaryFields(permission, req.userId!);
    if (!permissionSummary.can_current_user_run) {
        throw {
            status: 403,
            message: permissionSummary.is_run_locked_due_to_missing_users
                ? 'Workflow cannot be run because no allowed users remain'
                : 'You do not have permission to run this workflow. Please contact the workflow owner to request permission.'
        };
    }

    await ensureWorkflowMatchesApprovedSnapshotForRun(workflow_slug);

    const run = await prisma.$transaction(async (tx) => {
        const createdRun = await tx.workflow_runs.create({
            data: {
                workflow_slug: workflow_slug,
                ran_by_user_id: req.userId!,
                status: 'running',
                started_at: Date.now(),
                args: args !== undefined ? JSON.stringify(args) : null
            }
        });

        await tx.workflow_run_log_refs.create({
            data: {
                run_id: createdRun.id,
                session_id,
                message_id,
                created_at: BigInt(Date.now())
            }
        });

        return createdRun;
    });

    res.json({ run });
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
    });

    void startedRun.completion.catch(() => undefined);

    res.json({
        run_id: startedRun.runId
    });
}, true));

// POST /api/workflows/execute - Execute workflow from runWorkflow tool (backend-owned logic)
router.post('/execute', apiHandler(async (req, res) => {
    const body = req.body as {
        slug?: unknown;
        inputs?: unknown;
        message_id?: unknown;
        call_id?: unknown;
    };
    if (typeof body.slug !== 'string' || !body.slug.trim()) {
        throw {
            status: 400,
            message: 'slug is required'
        };
    }
    if (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs)) {
        throw {
            status: 400,
            message: 'inputs must be an object'
        };
    }
    if (typeof body.message_id !== 'string' || !body.message_id.trim()) {
        throw {
            status: 400,
            message: 'message_id is required'
        };
    }
    if (typeof body.call_id !== 'string' || !body.call_id.trim()) {
        throw {
            status: 400,
            message: 'call_id is required'
        };
    }
    if (!req.opencode_session_id) {
        throw {
            status: 400,
            message: 'This endpoint requires an opencode session token'
        };
    }

    const workspaceDir = getWorkspaceDirFromEnv();
    await assertCurrentUserCanRunWorkflow(body.slug, req.userId!);
    const startedRun = await startWorkflowRunViaBackend({
        workspaceDir,
        slug: body.slug,
        inputs: body.inputs as Record<string, unknown>,
        authUserId: req.userId!,
        sessionId: req.opencode_session_id,
        messageId: body.message_id,
        callId: body.call_id,
        requirePermissionPrompt: true,
    });

    const result = await startedRun.completion;
    const responsePayload = {
        status: result.status,
        output: result.output,
        workflow: body.slug,
        timeout_seconds: startedRun.timeoutSeconds,
        run_id: startedRun.runId,
    };

    if (result.status !== 'success') {
        throw {
            status: 500,
            message: "Workflow execution failed: " + JSON.stringify(responsePayload),
            doLogging: false,
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

    await prisma.workflow_runs.deleteMany({
        where: { workflow_slug: slug }
    });
    await prisma.workflow_metadata.deleteMany({
        where: { workflow_slug: slug }
    });

    deleteWorkflowDirectory(slug);

    res.json({ success: true });
}, true));

// GET /api/workflows/users - List users for permission picker
router.get('/users', apiHandler(async (_req, res) => {
    const users = await prisma.users.findMany({
        orderBy: { name: 'asc' },
        select: {
            id: true,
            name: true,
            email: true,
            role: true
        }
    });

    res.json({ users });
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

// GET /api/workflows/:slug/files/access - Get workflow editor access capabilities
router.get('/:slug/files/access', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const access = await getWorkflowEditorAccess(slug, req.userId!, req.role);
    res.json(access);
}, true));

// GET /api/workflows/:slug/files/tree - List a workflow directory (lazy)
router.get('/:slug/files/tree', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await readWorkflowManifestAndEnsurePermissions(slug);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    const tree = listWorkflowDirectory(slug, rawPath);
    res.json(tree);
}, true));

// GET /api/workflows/:slug/files/content - Read a workflow file
router.get('/:slug/files/content', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await readWorkflowManifestAndEnsurePermissions(slug);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    const content = readWorkflowFileContent(slug, rawPath);
    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json(content);
}, true));

// PUT /api/workflows/:slug/files/content - Save a workflow file
router.put('/:slug/files/content', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditWorkflowFiles(slug, req.userId!, req.role);
    const { path, content, base_etag } = req.body as {
        path?: unknown;
        content?: unknown;
        base_etag?: unknown;
    };
    if (typeof path !== "string" || typeof content !== "string" || typeof base_etag !== "string") {
        throw {
            status: 400,
            message: "path, content, and base_etag are required"
        };
    }
    const result = saveWorkflowFileContent(slug, {
        path,
        content,
        base_etag,
    });
    res.json(result);
}, true));

// POST /api/workflows/:slug/files - Create a file or folder
router.post('/:slug/files', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditWorkflowFiles(slug, req.userId!, req.role);
    const { parent_path, name, kind } = req.body as { parent_path?: unknown; name?: unknown; kind?: unknown };
    if (typeof name !== "string" || (kind !== "file" && kind !== "directory")) {
        throw {
            status: 400,
            message: 'name and kind ("file" or "directory") are required'
        };
    }
    const node = createWorkflowFileOrFolder(slug, typeof parent_path === "string" ? parent_path : "", name, kind);
    res.json({ node });
}, true));

// POST /api/workflows/:slug/files/upload - Upload a file to a workflow folder
router.post('/:slug/files/upload', workflowFileUpload.single("file"), apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditWorkflowFiles(slug, req.userId!, req.role);
    const { parent_path, name } = req.body as {
        parent_path?: unknown;
        name?: unknown;
    };
    if (typeof name !== "string") {
        throw {
            status: 400,
            message: "name is required"
        };
    }
    if (!req.file?.path) {
        throw {
            status: 400,
            message: "file is required"
        };
    }

    try {
        const node = uploadWorkflowFileFromTempPath(slug, typeof parent_path === "string" ? parent_path : "", name, req.file.path);
        res.json({ node });
    } finally {
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
}, true));

// PATCH /api/workflows/:slug/files/rename - Rename a file or folder
router.patch('/:slug/files/rename', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditWorkflowFiles(slug, req.userId!, req.role);
    const { path, new_name } = req.body as { path?: unknown; new_name?: unknown };
    if (typeof path !== "string" || typeof new_name !== "string") {
        throw {
            status: 400,
            message: "path and new_name are required"
        };
    }
    const result = renameWorkflowPath(slug, path, new_name);
    res.json(result);
}, true));

// DELETE /api/workflows/:slug/files - Delete a file or folder
router.delete('/:slug/files', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditWorkflowFiles(slug, req.userId!, req.role);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    deleteWorkflowPath(slug, rawPath);
    res.json({ success: true });
}, true));

// GET /api/workflows/:slug - Get workflow details from filesystem
router.get('/:slug', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const { manifest, metadata } = await readWorkflowManifestAndEnsurePermissions(slug);
    const permission = await getWorkflowRunPermissionWithUsers(slug);
    const permissionSummary = getPermissionSummaryFields(permission, req.userId!);
    const approvalState = await getWorkflowSnapshotApprovalState(slug);

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
    res.json({
        workflow: {
            slug,
            name: slug,
            intent_summary: manifest.intent_summary,
            created_by_user_id: createdByUserId,
            created_by_user_name: creator?.name ?? null,
            created_by_user_email: creator?.email ?? null,
            approved_by_user_id: approvedByUserId,
            is_approved: approvalState.is_current_code_approved,
            approved_by_user_name: approver?.name ?? null,
            approved_by_user_email: approver?.email ?? null,
            ...permissionSummary,
            run_permissions: mapPermissionToApi(permission),
            allowed_runners_resolved: permission.allowedUsers.map((row) => ({
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

// PATCH /api/workflows/:slug/run-permissions - Update run permissions
router.patch('/:slug/run-permissions', apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const { metadata } = await readWorkflowManifestAndEnsurePermissions(slug);

    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: 'Workflow must be approved before updating run permissions'
        };
    }

    const currentPermission = await getWorkflowRunPermissionWithUsers(slug);
    const currentSummary = getPermissionSummaryFields(currentPermission, req.userId!);
    if (!currentSummary.can_current_user_manage_run_permissions) {
        throw {
            status: 403,
            message: currentSummary.is_run_locked_due_to_missing_users
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
    const updatedSummary = getPermissionSummaryFields(updatedPermission, req.userId!);

    res.json({
        workflow: {
            slug,
            ...updatedSummary,
            run_permissions: mapPermissionToApi(updatedPermission),
            allowed_runners_resolved: updatedPermission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            }))
        }
    });
}, true));

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

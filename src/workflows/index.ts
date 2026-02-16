import express from "express";
import prisma from "../prisma/client";
import { WorkflowSummary } from "../types/workflow";
import { apiHandler } from "../utils/index";
import {
    listWorkflowSlugs,
    readWorkflowManifest,
    approveWorkflow
} from "../utils/workflow";

const router = express.Router({ mergeParams: true });

// GET /api/workflows - List available workflows from filesystem
router.get('/', apiHandler(async (req, res) => {
    const slugs = listWorkflowSlugs();
    const workflows: WorkflowSummary[] = [];

    for (const slug of slugs) {
        const manifest = readWorkflowManifest(slug);
        if (manifest) {
            workflows.push({
                slug,
                name: slug,
                intent_summary: manifest.intent_summary,
                approved_by_user_id: manifest.approved_by_user_id
            });
        }
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

// POST /api/workflows/runs - Create new workflow run record
router.post('/runs', apiHandler(async (req, res) => {
    const { workflow_slug, args } = req.body;

    if (!workflow_slug) {
        throw {
            status: 400,
            message: 'workflow_slug are required'
        };
    }

    const manifest = readWorkflowManifest(workflow_slug);

    if (manifest.approved_by_user_id === null) {
        throw {
            status: 403,
            message: 'Workflow is not approved yet'
        };
    }

    const run = await prisma.workflow_runs.create({
        data: {
            workflow_slug: workflow_slug,
            ran_by_user_id: req.userId!,
            status: 'running',
            started_at: Date.now(),
            args: args ? JSON.stringify(args) : null
        }
    });

    res.json({ run });
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

    await approveWorkflow(slug, req.userId!);

    res.json({
        workflow: {
            slug,
            approved_by_user_id: req.userId!
        }
    });
}, true));

export default router;

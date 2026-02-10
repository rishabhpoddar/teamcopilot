import express from "express";
import fs from "fs";
import path from "path";
import prisma from "../prisma/client";
import { apiHandler } from "../utils";

const router = express.Router({ mergeParams: true });

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "./my_workspaces";

function getWorkspacePath(): string {
    if (path.isAbsolute(WORKSPACE_DIR)) {
        return WORKSPACE_DIR;
    }
    return path.join(process.cwd(), WORKSPACE_DIR);
}

interface WorkflowManifest {
    name: string;
    description?: string;
    version?: string;
}

interface Workflow {
    slug: string;
    name: string;
    description?: string;
    version?: string;
}

// GET /api/workflows - List available workflows from filesystem
router.get('/', apiHandler(async (req, res) => {
    const workspacePath = getWorkspacePath();
    const workflowsDir = path.join(workspacePath, "workflows");

    if (!fs.existsSync(workflowsDir)) {
        res.json({ workflows: [] });
        return;
    }

    const workflows: Workflow[] = [];
    const entries = fs.readdirSync(workflowsDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(workflowsDir, entry.name, "workflow.json");
        if (!fs.existsSync(manifestPath)) continue;

        try {
            const manifestContent = fs.readFileSync(manifestPath, "utf-8");
            const manifest: WorkflowManifest = JSON.parse(manifestContent);
            workflows.push({
                slug: entry.name,
                name: manifest.name || entry.name,
                description: manifest.description,
                version: manifest.version
            });
        } catch {
            // Skip invalid manifests
            continue;
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
    const { workflow_slug, workflow_name, args } = req.body;

    if (!workflow_slug || !workflow_name) {
        throw {
            status: 400,
            message: 'workflow_slug and workflow_name are required'
        };
    }

    const run = await prisma.workflow_runs.create({
        data: {
            workflow_slug,
            workflow_name,
            user_id: req.userId!,
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
    const { status, error_message } = req.body;

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

    const updateData: { status: string; completed_at?: bigint; error_message?: string } = { status };

    if (status === 'success' || status === 'failed') {
        updateData.completed_at = BigInt(Date.now());
    }

    if (status === 'failed' && error_message) {
        updateData.error_message = error_message;
    }

    const run = await prisma.workflow_runs.update({
        where: { id },
        data: updateData
    });

    res.json({ run });
}, true));

export default router;

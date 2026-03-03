/**
 * Helper functions for workflow.json operations.
 */

import fs from "fs";
import path from "path";
import { WorkflowManifest, WorkflowMetadata } from "../types/workflow";
import prisma from "../prisma/client";
import { assertCondition, assertEnv } from "./assert";
import { ensureWorkflowRunPermissionsForMetadata } from "./workflow-permissions";

const WORKSPACE_DIR = assertEnv("WORKSPACE_DIR");

/** Get the absolute path to the workspace directory */
export function getWorkspacePath(): string {
    if (path.isAbsolute(WORKSPACE_DIR)) {
        return WORKSPACE_DIR;
    }
    return path.join(process.cwd(), WORKSPACE_DIR);
}

/** Get the path to a workflow directory */
export function getWorkflowPath(slug: string): string {
    return path.join(getWorkspacePath(), "workflows", slug);
}

/** Get the path to a workflow's manifest file */
export function getWorkflowManifestPath(slug: string): string {
    return path.join(getWorkflowPath(slug), "workflow.json");
}

/** Delete a workflow directory and all of its contents */
export function deleteWorkflowDirectory(slug: string): void {
    const workflowPath = getWorkflowPath(slug);

    if (!fs.existsSync(workflowPath)) {
        throw {
            status: 404,
            message: `Workflow not found for slug: ${slug}`
        };
    }

    fs.rmSync(workflowPath, { recursive: true, force: false });
}

/** Check if a workflow exists */
export function workflowExists(slug: string): boolean {
    return fs.existsSync(getWorkflowManifestPath(slug));
}

/** Read a workflow's manifest */
function readWorkflowManifest(slug: string): WorkflowManifest {
    const manifestPath = getWorkflowManifestPath(slug);

    if (!fs.existsSync(manifestPath)) {
        throw {
            status: 404,
            message: `Workflow manifest not found for slug: ${slug}`
        };
    }

    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as WorkflowManifest;
}

export async function readWorkflowManifestAndEnsurePermissions(slug: string): Promise<{
    manifest: WorkflowManifest;
    metadata: WorkflowMetadata;
}> {
    const manifest = readWorkflowManifest(slug);
    const metadata = await getOrCreateWorkflowMetadataAndEnsurePermission(slug);
    return { manifest, metadata };
}


/** Set workflow creator in database metadata */
export async function setWorkflowCreator(slug: string, userId: string): Promise<WorkflowMetadata> {
    readWorkflowManifest(slug);
    const existing = await getOrCreateWorkflowMetadataAndEnsurePermission(slug);
    if (existing.created_by_user_id) {
        assertCondition(existing.created_by_user_id === userId, "Workflow creator mismatch");
        return existing;
    }

    const now = BigInt(Date.now());
    const row = await prisma.workflow_metadata.update({
        where: { workflow_slug: slug },
        data: {
            created_by_user_id: userId,
            updated_at: now,
        }
    });
    return {
        workflow_slug: row.workflow_slug,
        created_by_user_id: row.created_by_user_id,
        approved_by_user_id: row.approved_by_user_id,
    };
}

/** List all workflow slugs */
export function listWorkflowSlugs(): string[] {
    const workflowsDir = path.join(getWorkspacePath(), "workflows");

    if (!fs.existsSync(workflowsDir)) {
        return [];
    }

    const entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
    const slugs: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(workflowsDir, entry.name, "workflow.json");
        if (fs.existsSync(manifestPath)) {
            slugs.push(entry.name);
        }
    }

    return slugs;
}

async function getOrCreateWorkflowMetadataAndEnsurePermission(slug: string): Promise<WorkflowMetadata> {
    readWorkflowManifest(slug);
    const existing = await prisma.workflow_metadata.findUnique({
        where: { workflow_slug: slug }
    });
    if (existing) {
        const metadata: WorkflowMetadata = {
            workflow_slug: existing.workflow_slug,
            created_by_user_id: existing.created_by_user_id,
            approved_by_user_id: existing.approved_by_user_id,
        };
        await ensureWorkflowRunPermissionsForMetadata(slug, metadata);
        return metadata;
    }

    const now = BigInt(Date.now());
    const row = await prisma.workflow_metadata.create({
        data: {
            workflow_slug: slug,
            created_at: now,
            updated_at: now,
        }
    });
    const metadata: WorkflowMetadata = {
        workflow_slug: row.workflow_slug,
        created_by_user_id: row.created_by_user_id,
        approved_by_user_id: row.approved_by_user_id,
    };
    await ensureWorkflowRunPermissionsForMetadata(slug, metadata);
    return metadata;
}

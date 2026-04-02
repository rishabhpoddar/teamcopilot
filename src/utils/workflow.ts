/**
 * Helper functions for workflow.json operations.
 */

import fs from "fs";
import path from "path";
import { WorkflowManifest, WorkflowMetadata } from "../types/workflow";
import prisma from "../prisma/client";
import { assertCondition } from "./assert";
import { ensureWorkflowRunPermissionsForMetadata } from "./workflow-permissions";
import { getWorkspaceDirFromEnv } from "./workspace-sync";
import { normalizeSecretKeyList } from "./secrets";

/** Get the absolute path to the workspace directory */
function getWorkspacePath(): string {
    return getWorkspaceDirFromEnv();
}

/** Get the path to a workflow directory */
export function getWorkflowPath(slug: string): string {
    return path.join(getWorkspacePath(), "workflows", slug);
}

/** Get the path to a workflow's manifest file */
function getWorkflowManifestPath(slug: string): string {
    return path.join(getWorkflowPath(slug), "workflow.json");
}

/** Delete a workflow directory and all of its contents */
function deleteWorkflowDirectory(slug: string): void {
    const workflowPath = getWorkflowPath(slug);

    if (!fs.existsSync(workflowPath)) {
        throw {
            status: 404,
            message: `Workflow not found for slug: ${slug}`
        };
    }

    fs.rmSync(workflowPath, { recursive: true, force: false });
}

export async function deleteWorkflow(slug: string): Promise<void> {
    await prisma.workflow_runs.deleteMany({
        where: { workflow_slug: slug }
    });
    await prisma.resource_metadata.deleteMany({
        where: {
            resource_kind: "workflow",
            resource_slug: slug
        }
    });
    await prisma.resource_permissions.deleteMany({
        where: {
            resource_kind: "workflow",
            resource_slug: slug
        }
    });

    if (fs.existsSync(getWorkflowPath(slug))) {
        deleteWorkflowDirectory(slug);
    }
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
    const manifest = JSON.parse(content) as WorkflowManifest;
    manifest.required_secrets = normalizeSecretKeyList(manifest.required_secrets);
    return manifest;
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
    const { metadata: existing } = await readWorkflowManifestAndEnsurePermissions(slug);
    if (existing.created_by_user_id) {
        assertCondition(existing.created_by_user_id === userId, "Workflow creator mismatch");
        return existing;
    }

    const now = BigInt(Date.now());
    const row = await prisma.resource_metadata.update({
        where: {
            resource_kind_resource_slug: {
                resource_kind: "workflow",
                resource_slug: slug
            }
        },
        data: {
            created_by_user_id: userId,
            updated_at: now,
        }
    });
    return {
        workflow_slug: row.resource_slug,
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
    const existing = await prisma.resource_metadata.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: "workflow",
                resource_slug: slug
            }
        }
    });
    if (existing) {
        const metadata: WorkflowMetadata = {
            workflow_slug: existing.resource_slug,
            created_by_user_id: existing.created_by_user_id,
            approved_by_user_id: existing.approved_by_user_id,
        };
        await ensureWorkflowRunPermissionsForMetadata(slug, metadata);
        return metadata;
    }

    const now = BigInt(Date.now());
    const row = await prisma.resource_metadata.create({
        data: {
            resource_kind: "workflow",
            resource_slug: slug,
            created_at: now,
            updated_at: now,
        }
    });
    const metadata: WorkflowMetadata = {
        workflow_slug: row.resource_slug,
        created_by_user_id: row.created_by_user_id,
        approved_by_user_id: row.approved_by_user_id,
    };
    await ensureWorkflowRunPermissionsForMetadata(slug, metadata);
    return metadata;
}

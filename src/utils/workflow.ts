/**
 * Helper functions for workflow.json operations.
 */

import fs from "fs";
import path from "path";
import { WorkflowManifest } from "../types/workflow";
import prisma from "../prisma/client";
import { assertEnv } from "./assert";

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
export function readWorkflowManifest(slug: string): WorkflowManifest {
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

/** Write a workflow's manifest */
export function writeWorkflowManifest(slug: string, manifest: WorkflowManifest): void {
    const manifestPath = getWorkflowManifestPath(slug);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

/** Update specific fields in a workflow's manifest */
export function updateWorkflowManifest(
    slug: string,
    updates: Partial<WorkflowManifest>
): WorkflowManifest {
    const manifest = readWorkflowManifest(slug);
    const updatedManifest = { ...manifest, ...updates };
    writeWorkflowManifest(slug, updatedManifest);
    return updatedManifest;
}

/** Check if a workflow is approved */
export function isWorkflowApproved(slug: string): boolean {
    const manifest = readWorkflowManifest(slug);
    return manifest.approved_by_user_id != null;
}

/** Approve a workflow */
export async function approveWorkflow(slug: string, userId: string): Promise<WorkflowManifest> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
        throw {
            status: 404,
            message: 'User not found'
        };
    }

    if (user.role !== 'Engineer') {
        throw {
            status: 403,
            message: 'Only Engineers can approve workflows'
        };
    }

    return updateWorkflowManifest(slug, { approved_by_user_id: userId });
}

/** Set workflow creator on workflow.json */
export function setWorkflowCreator(slug: string, userId: string): WorkflowManifest {
    return updateWorkflowManifest(slug, { created_by_user_id: userId });
}

/** Get the timeout for a workflow (defaults to 300 seconds) */
export function getWorkflowTimeout(slug: string): number {
    const manifest = readWorkflowManifest(slug);
    return manifest.runtime.timeout_seconds;
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

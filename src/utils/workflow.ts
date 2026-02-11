/**
 * Helper functions for workflow.json operations.
 */

import fs from "fs";
import path from "path";
import { WorkflowManifest } from "../types/workflow";

const WORKSPACE_DIR = process.env.WORKSPACE_DIR!;

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

/** Check if a workflow exists */
export function workflowExists(slug: string): boolean {
    return fs.existsSync(getWorkflowManifestPath(slug));
}

/** Read a workflow's manifest */
export function readWorkflowManifest(slug: string): WorkflowManifest | null {
    const manifestPath = getWorkflowManifestPath(slug);

    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        return JSON.parse(content) as WorkflowManifest;
    } catch {
        return null;
    }
}

/** Write a workflow's manifest */
export function writeWorkflowManifest(slug: string, manifest: WorkflowManifest): boolean {
    const manifestPath = getWorkflowManifestPath(slug);

    try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        return true;
    } catch {
        return false;
    }
}

/** Update specific fields in a workflow's manifest */
export function updateWorkflowManifest(
    slug: string,
    updates: Partial<WorkflowManifest>
): WorkflowManifest | null {
    const manifest = readWorkflowManifest(slug);

    if (!manifest) {
        return null;
    }

    const updatedManifest = { ...manifest, ...updates };

    if (writeWorkflowManifest(slug, updatedManifest)) {
        return updatedManifest;
    }

    return null;
}

/** Check if a workflow is approved */
export function isWorkflowApproved(slug: string): boolean {
    const manifest = readWorkflowManifest(slug);
    return manifest?.approved_by_user_id != null;
}

/** Approve a workflow */
export function approveWorkflow(slug: string, userId: string): WorkflowManifest | null {
    return updateWorkflowManifest(slug, { approved_by_user_id: userId });
}

/** Get the timeout for a workflow (defaults to 300 seconds) */
export function getWorkflowTimeout(slug: string): number {
    const manifest = readWorkflowManifest(slug);
    return manifest?.runtime?.timeout_seconds ?? 300;
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

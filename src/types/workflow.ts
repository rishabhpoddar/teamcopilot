/**
 * Shared workflow types used across the backend.
 * These types mirror the workflow.json schema.
 */


export interface WorkflowInput {
    type: "string" | "number" | "boolean"
    required?: boolean
    default?: string | number | boolean
    description?: string
}

export interface WorkflowManifest {
    intent_summary: string
    inputs: Record<string, WorkflowInput>
    triggers: {
        manual?: boolean
    }
    runtime: {
        timeout_seconds: number
    }
}

export interface WorkflowMetadata {
    workflow_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    run_permission_mode: WorkflowRunPermissionMode;
}

export type WorkflowRunPermissionMode = "restricted" | "everyone";

export interface WorkflowRunPermissionsRestricted {
    mode: "restricted";
    allowed_user_ids: string[];
}

export interface WorkflowRunPermissionsEveryone {
    mode: "everyone";
}

export type WorkflowRunPermissions = WorkflowRunPermissionsRestricted | WorkflowRunPermissionsEveryone;

/** Workflow summary for API responses */
export interface WorkflowSummary {
    slug: string;
    name: string;
    intent_summary: string;
    created_by_user_id: string | null;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    run_permission_mode: WorkflowRunPermissionMode;
    can_current_user_run: boolean;
    can_current_user_manage_run_permissions: boolean;
    allowed_runner_count: number;
    is_run_locked_due_to_missing_users: boolean;
}

/** Alias for frontend compatibility */
export type Workflow = WorkflowSummary;

/** Workflow run status */
export type WorkflowRunStatus = "running" | "success" | "failed";

/** Workflow run record */
export interface WorkflowRun {
    id: string;
    workflow_slug: string;
    ran_by_user_id: string;
    status: WorkflowRunStatus;
    started_at: number;
    completed_at: number | null;
    args: string | null;
    error_message: string | null;
    user: {
        name: string;
        email: string;
    };
}

/**
 * Shared workflow types used across the backend.
 * These types mirror the workflow.json schema.
 */
import type { PermissionMode } from "./permissions";


export interface WorkflowInput {
    type: "string" | "number" | "boolean"
    required?: boolean
    default?: string | number | boolean
    description?: string
}

export interface WorkflowManifest {
    intent_summary: string
    inputs: Record<string, WorkflowInput>
    required_secrets?: string[]
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
}

/** Workflow summary for API responses */
export interface WorkflowSummary {
    slug: string;
    name: string;
    intent_summary: string;
    created_by_user_id: string | null;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    is_approved: boolean;
    can_view: boolean;
    can_edit: boolean;
    permission_mode: PermissionMode;
    is_locked_due_to_missing_users: boolean;
    required_secrets: string[];
    missing_required_secrets: string[];
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
    output: string | null;
    user: {
        name: string;
        email: string;
    };
}

export type WorkflowApprovalDiffFileStatus = "added" | "modified" | "deleted";
export type WorkflowApprovalDiffFileKind = "text" | "binary";

export interface WorkflowApprovalDiffFile {
    path: string;
    status: WorkflowApprovalDiffFileStatus;
    kind: WorkflowApprovalDiffFileKind;
    old_size_bytes: number | null;
    new_size_bytes: number | null;
    patch_lines: string[] | null;
    is_truncated: boolean;
    message: string | null;
}

export interface WorkflowApprovalDiffSummary {
    added: number;
    modified: number;
    deleted: number;
    text_files: number;
    binary_files: number;
}

export interface WorkflowApprovalDiffResponse {
    has_previous_snapshot: boolean;
    summary: WorkflowApprovalDiffSummary;
    files: WorkflowApprovalDiffFile[];
    ignored_rules: string[];
}

export type SnapshotContentKind = "text" | "binary";
export type ApprovalDiffFileStatus = "added" | "deleted" | "modified";

export interface WorkflowSnapshotFile {
    relative_path: string;
    content_kind: SnapshotContentKind;
    text_content: string | null;
    binary_content: Uint8Array | null;
    size_bytes: number;
    content_sha256: string;
}

export interface WorkflowSnapshot {
    workflow_slug: string;
    snapshot_hash: string;
    file_count: number;
    files: WorkflowSnapshotFile[];
}

export interface WorkflowSnapshotApprovalState {
    has_approved_snapshot: boolean;
    is_current_code_approved: boolean;
}

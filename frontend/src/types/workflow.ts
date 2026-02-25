/**
 * Re-export workflow types from the backend for frontend use.
 * This ensures type consistency between frontend and backend.
 */
export type {
    WorkflowInput,
    WorkflowManifest,
    WorkflowSummary,
    Workflow,
    WorkflowRunStatus,
    WorkflowRun,
    WorkflowApprovalDiffFile,
    WorkflowApprovalDiffSummary,
    WorkflowApprovalDiffResponse,
} from "../../../src/types/workflow";

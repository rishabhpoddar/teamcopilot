/**
 * Re-export workflow types from the backend for frontend use.
 * This ensures type consistency between frontend and backend.
 */
export type {
    WorkflowInput,
    Workflow,
    WorkflowRunStatus,
    WorkflowRun,
    WorkflowApiKey,
    WorkflowApprovalDiffResponse,
} from "../../../src/types/shared/workflow";

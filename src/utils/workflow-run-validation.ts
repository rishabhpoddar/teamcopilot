import { getResourceAccessSummary } from "./resource-access";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";
import { getWorkflowSnapshotApprovalState } from "./workflow-approval-snapshot";

export async function assertUserCanRunWorkflow(slug: string, userId: string): Promise<void> {
    await readWorkflowManifestAndEnsurePermissions(slug);
    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: "Workflow is not approved for the current code version"
        };
    }

    const permissionSummary = await getResourceAccessSummary("workflow", slug, userId);
    if (!permissionSummary.can_edit) {
        throw {
            status: 403,
            message: permissionSummary.is_locked_due_to_missing_users
                ? "Workflow cannot be run because no allowed users remain"
                : "You do not have permission to run this workflow. Please contact the workflow owner to request permission."
        };
    }
}

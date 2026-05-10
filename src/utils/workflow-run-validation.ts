import type { WorkflowManifest } from "../types/workflow";
import { getResourceAccessSummary } from "./resource-access";
import { resolveSecretsForUser } from "./secrets";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";
import { getWorkflowSnapshotApprovalState } from "./workflow-approval-snapshot";
import { validateInputs } from "./workflow-runner";

export async function assertUserCanRunWorkflow(slug: string, userId: string): Promise<{
    manifest: WorkflowManifest;
}> {
    const { manifest } = await readWorkflowManifestAndEnsurePermissions(slug);
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

    return { manifest };
}

export async function validateUserWorkflowRunInputs(input: {
    slug: string;
    inputs: Record<string, unknown>;
    userId: string;
}): Promise<{
    processedInputs: Record<string, string | number | boolean>;
}> {
    const { manifest } = await assertUserCanRunWorkflow(input.slug, input.userId);
    const secretResolution = await resolveSecretsForUser(input.userId, manifest.required_secrets ?? []);
    if (secretResolution.missingKeys.length > 0) {
        throw {
            status: 400,
            message: `Missing required secrets for workflow: ${secretResolution.missingKeys.join(", ")}`
        };
    }
    const validation = validateInputs(input.inputs, manifest.inputs ?? {});
    if (!validation.valid) {
        throw {
            status: 400,
            message: `Workflow input validation failed: ${validation.errors.join("; ")}`
        };
    }
    return {
        processedInputs: validation.processedInputs,
    };
}

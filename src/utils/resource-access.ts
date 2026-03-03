import { ResourceKind, assertCommonPermissionMode, getPermissionSummaryForApi, getResourceAccess, getResourcePermissionWithUsers } from "./permission-common";
import { isEngineerUser } from "./user-role";
import { getSkillSnapshotApprovalState } from "./skill-approval-snapshot";
import { getWorkflowSnapshotApprovalState } from "./workflow-approval-snapshot";
import { readSkillManifestAndEnsurePermissions } from "./skill";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";

export interface ResourceAccessSummary {
    permission_mode: "restricted" | "everyone";
    can_current_user_use: boolean;
    can_current_user_manage_permissions: boolean;
    allowed_user_count: number;
    is_locked_due_to_missing_users: boolean;
    is_approved: boolean;
    can_view: boolean;
    can_edit: boolean;
}

export async function getResourceAccessSummary(
    resourceType: ResourceKind,
    slug: string,
    userId: string
): Promise<ResourceAccessSummary> {
    if (resourceType === "workflow") {
        await readWorkflowManifestAndEnsurePermissions(slug);
    } else {
        await readSkillManifestAndEnsurePermissions(slug);
    }

    const permission = await getResourcePermissionWithUsers(
        resourceType,
        slug,
        resourceType === "workflow" ? "Workflow run" : "Skill access"
    );
    const mode = assertCommonPermissionMode(
        permission.permission_mode,
        resourceType === "workflow" ? "workflow run" : "skill access"
    );
    const permissionSummary = getPermissionSummaryForApi(
        mode,
        permission.allowedUsers.map((row) => row.user_id),
        userId
    );
    const approvalState = resourceType === "workflow"
        ? await getWorkflowSnapshotApprovalState(slug)
        : await getSkillSnapshotApprovalState(slug);
    const isEngineer = await isEngineerUser(userId);
    const access = getResourceAccess(
        resourceType,
        approvalState.is_current_code_approved,
        isEngineer,
        permissionSummary.can_current_user_use
    );

    return {
        ...permissionSummary,
        is_approved: approvalState.is_current_code_approved,
        can_view: access.canView,
        can_edit: access.canEdit,
    };
}

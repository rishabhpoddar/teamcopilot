import { ResourceKind, assertCommonPermissionMode, getResourcePermissionWithUsers } from "./permission-common";
import { isEngineerUser } from "./user-role";
import { getSkillSnapshotApprovalState } from "./skill-approval-snapshot";
import { getWorkflowSnapshotApprovalState } from "./workflow-approval-snapshot";
import { readSkillManifestAndEnsurePermissions } from "./skill";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";

interface ResourceAccessSummary {
    permission_mode: "restricted" | "everyone";
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
    const allowedUserIds = permission.allowedUsers.map((row) => row.user_id);
    const canCurrentUserUse = mode === "everyone" || allowedUserIds.includes(userId);
    const isLockedDueToMissingUsers = mode === "restricted" && allowedUserIds.length === 0;
    const approvalState = resourceType === "workflow"
        ? await getWorkflowSnapshotApprovalState(slug)
        : await getSkillSnapshotApprovalState(slug);
    const isEngineer = await isEngineerUser(userId);
    const canEdit = approvalState.is_current_code_approved
        ? canCurrentUserUse
        : (isEngineer || canCurrentUserUse);
    const canView = canEdit;

    return {
        permission_mode: mode,
        is_locked_due_to_missing_users: isLockedDueToMissingUsers,
        is_approved: approvalState.is_current_code_approved,
        can_view: canView,
        can_edit: canEdit,
    };
}

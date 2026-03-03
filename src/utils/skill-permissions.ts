import { PermissionMode, Permissions } from "../types/permissions";
import {
    ResourcePermissionWithUsers,
    addUserToResourcePermissionsIfRestricted,
    assertCommonPermissionMode,
    getCommonPermissionSummary,
    getResourcePermissionWithUsers,
    setResourcePermissions,
} from "./permission-common";

type SkillPermissionWithUsers = ResourcePermissionWithUsers;

export async function getSkillAccessPermissionWithUsers(slug: string): Promise<SkillPermissionWithUsers> {
    return getResourcePermissionWithUsers("skill", slug, "Skill access");
}

export function getSkillPermissionSummaryFields(
    permission: SkillPermissionWithUsers,
    currentUserId: string,
): {
    permission_mode: PermissionMode;
    can_current_user_use: boolean;
    can_current_user_manage_permissions: boolean;
    allowed_user_count: number;
    is_locked_due_to_missing_users: boolean;
} {
    const mode = assertCommonPermissionMode(permission.permission_mode, "skill access");
    const summary = getCommonPermissionSummary(
        mode,
        permission.allowedUsers.map((row) => row.user_id),
        currentUserId
    );

    return {
        permission_mode: mode,
        can_current_user_use: summary.canCurrentUserUse,
        can_current_user_manage_permissions: summary.canCurrentUserUse,
        allowed_user_count: summary.allowedUserCount,
        is_locked_due_to_missing_users: summary.isLockedDueToMissingUsers
    };
}

export async function setSkillAccessPermissions(
    slug: string,
    payload: Permissions,
    ownerUserId: string | null,
): Promise<SkillPermissionWithUsers> {
    return setResourcePermissions("skill", slug, payload, ownerUserId);
}

export async function addApproverToSkillAccessPermissionsIfRestricted(
    slug: string,
    approverUserId: string,
    ownerUserId: string | null,
): Promise<void> {
    await addUserToResourcePermissionsIfRestricted("skill", slug, approverUserId, ownerUserId);
}

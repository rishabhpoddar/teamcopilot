import { SkillAccessPermissions, SkillAccessPermissionMode } from "../types/skill";
import {
    CommonPermissions,
    ResourcePermissionWithUsers,
    assertCommonPermissionMode,
    canUserUseFromMode,
    getCommonPermissionSummary,
    getResourcePermissionWithUsers,
    mapPermissionToApiCommon,
    setResourcePermissions,
} from "./permission-common";

type SkillPermissionWithUsers = ResourcePermissionWithUsers;

function assertSkillPermissionMode(mode: string): SkillAccessPermissionMode {
    return assertCommonPermissionMode(mode, "skill access");
}

export async function getSkillAccessPermissionWithUsers(slug: string): Promise<SkillPermissionWithUsers> {
    return getResourcePermissionWithUsers("skill", slug, "Skill access");
}

export function mapSkillPermissionToApi(permission: SkillPermissionWithUsers): SkillAccessPermissions {
    const mode = assertSkillPermissionMode(permission.permission_mode);
    const allowedUserIds = permission.allowedUsers.map((row) => row.user_id);
    return mapPermissionToApiCommon(mode, allowedUserIds);
}

export function canUserAccessSkillFromPermission(permission: SkillPermissionWithUsers, userId: string): boolean {
    const mode = assertSkillPermissionMode(permission.permission_mode);
    return canUserUseFromMode(mode, permission.allowedUsers.map((row) => row.user_id), userId);
}

export function getSkillPermissionSummaryFields(
    permission: SkillPermissionWithUsers,
    currentUserId: string,
): {
    access_permission_mode: SkillAccessPermissionMode;
    can_current_user_use_skill: boolean;
    can_current_user_manage_access_permissions: boolean;
    allowed_user_count: number;
    is_access_locked_due_to_missing_users: boolean;
} {
    const mode = assertSkillPermissionMode(permission.permission_mode);
    const summary = getCommonPermissionSummary(
        mode,
        permission.allowedUsers.map((row) => row.user_id),
        currentUserId
    );

    return {
        access_permission_mode: mode,
        can_current_user_use_skill: summary.canCurrentUserUse,
        can_current_user_manage_access_permissions: summary.canCurrentUserUse,
        allowed_user_count: summary.allowedUserCount,
        is_access_locked_due_to_missing_users: summary.isLockedDueToMissingUsers,
    };
}

export async function setSkillAccessPermissions(
    slug: string,
    payload: SkillAccessPermissions,
    ownerUserId: string | null,
): Promise<SkillPermissionWithUsers> {
    return setResourcePermissions("skill", slug, payload as CommonPermissions, ownerUserId);
}

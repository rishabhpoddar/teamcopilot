import { WorkflowMetadata, WorkflowRunPermissionMode, WorkflowRunPermissions } from "../types/workflow";
import {
    CommonPermissions,
    ResourcePermissionWithUsers,
    addUserToResourcePermissionsIfRestricted,
    assertCommonPermissionMode,
    canUserUseFromMode,
    ensureResourcePermissions,
    getCommonPermissionSummary,
    getResourcePermissionWithUsers,
    initializeResourcePermissionsForCreator,
    mapPermissionToApiCommon,
    setResourcePermissions,
} from "./permission-common";

type PermissionWithUsers = ResourcePermissionWithUsers;

function assertPermissionMode(mode: string): WorkflowRunPermissionMode {
    return assertCommonPermissionMode(mode, "workflow run");
}

function getDefaultCandidateUserIds(metadata: WorkflowMetadata): string[] {
    const ids = [metadata.created_by_user_id, metadata.approved_by_user_id].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
}

export async function ensureWorkflowRunPermissionsForMetadata(slug: string, metadata: WorkflowMetadata): Promise<void> {
    await ensureResourcePermissions("workflow", slug, getDefaultCandidateUserIds(metadata));
}

export async function initializeWorkflowRunPermissionsForCreator(slug: string, creatorUserId: string): Promise<void> {
    await initializeResourcePermissionsForCreator("workflow", slug, creatorUserId);
}

export async function addApproverToWorkflowRunPermissionsIfRestricted(
    slug: string,
    approverUserId: string,
    ownerUserId: string | null,
): Promise<void> {
    await addUserToResourcePermissionsIfRestricted("workflow", slug, approverUserId, ownerUserId);
}

export async function getWorkflowRunPermissionWithUsers(slug: string): Promise<PermissionWithUsers> {
    return getResourcePermissionWithUsers("workflow", slug, "Workflow run");
}

export function mapPermissionToApi(permission: PermissionWithUsers): WorkflowRunPermissions {
    const mode = assertPermissionMode(permission.permission_mode);
    const allowedUserIds = permission.allowedUsers.map((row) => row.user_id);
    return mapPermissionToApiCommon(mode, allowedUserIds);
}

export function canUserRunWorkflowFromPermission(permission: PermissionWithUsers, userId: string): boolean {
    const mode = assertPermissionMode(permission.permission_mode);
    return canUserUseFromMode(mode, permission.allowedUsers.map((row) => row.user_id), userId);
}

export function getPermissionSummaryFields(
    permission: PermissionWithUsers,
    currentUserId: string,
): {
    run_permission_mode: WorkflowRunPermissionMode;
    can_current_user_run: boolean;
    can_current_user_manage_run_permissions: boolean;
    allowed_runner_count: number;
    is_run_locked_due_to_missing_users: boolean;
} {
    const mode = assertPermissionMode(permission.permission_mode);
    const summary = getCommonPermissionSummary(
        mode,
        permission.allowedUsers.map((row) => row.user_id),
        currentUserId
    );

    return {
        run_permission_mode: mode,
        can_current_user_run: summary.canCurrentUserUse,
        can_current_user_manage_run_permissions: summary.canCurrentUserUse,
        allowed_runner_count: summary.allowedUserCount,
        is_run_locked_due_to_missing_users: summary.isLockedDueToMissingUsers
    };
}

export async function setWorkflowRunPermissions(
    slug: string,
    payload: WorkflowRunPermissions,
    ownerUserId: string | null,
): Promise<PermissionWithUsers> {
    return setResourcePermissions("workflow", slug, payload as CommonPermissions, ownerUserId);
}

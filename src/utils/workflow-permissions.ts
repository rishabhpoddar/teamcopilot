import { WorkflowMetadata } from "../types/workflow";
import { Permissions } from "../types/permissions";
import {
    ResourcePermissionWithUsers,
    addUserToResourcePermissionsIfRestricted,
    ensureResourcePermissions,
    getResourcePermissionWithUsers,
    initializeResourcePermissionsForCreator,
    setResourcePermissions,
} from "./permission-common";

type PermissionWithUsers = ResourcePermissionWithUsers;

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

export async function setWorkflowRunPermissions(
    slug: string,
    payload: Permissions,
    ownerUserId: string | null,
): Promise<PermissionWithUsers> {
    return setResourcePermissions("workflow", slug, payload, ownerUserId);
}

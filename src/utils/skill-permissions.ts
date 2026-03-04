import { Permissions } from "../types/permissions";
import {
    ResourcePermissionWithUsers,
    addUserToResourcePermissionsIfRestricted,
    getResourcePermissionWithUsers,
    setResourcePermissions,
} from "./permission-common";

type SkillPermissionWithUsers = ResourcePermissionWithUsers;

export async function getSkillAccessPermissionWithUsers(slug: string): Promise<SkillPermissionWithUsers> {
    return getResourcePermissionWithUsers("skill", slug, "Skill access");
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

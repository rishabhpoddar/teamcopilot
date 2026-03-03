import prisma from "../prisma/client";
import { SkillAccessPermissions, SkillAccessPermissionMode } from "../types/skill";
import {
    assertCommonPermissionMode,
    canUserUseFromMode,
    getCommonPermissionSummary,
    mapPermissionToApiCommon,
    resolveRestrictedPermissionUserIds,
} from "./permission-common";

type SkillPermissionWithUsers = {
    skill_slug: string;
    access_permission_mode: string;
    allowedUsers: Array<{ user_id: string; user: { id: string; name: string; email: string } }>;
};

function assertSkillPermissionMode(mode: string): SkillAccessPermissionMode {
    return assertCommonPermissionMode(mode, "skill access");
}

export async function getSkillAccessPermissionWithUsers(slug: string): Promise<SkillPermissionWithUsers> {
    const permission = await prisma.skill_metadata.findUnique({
        where: { skill_slug: slug },
        include: {
            allowedUsers: {
                include: {
                    user: {
                        select: { id: true, name: true, email: true }
                    }
                },
                orderBy: { created_at: "asc" }
            }
        }
    });
    if (!permission) {
        throw {
            status: 500,
            message: `Skill access permissions missing for skill: ${slug}`
        };
    }
    return permission as SkillPermissionWithUsers;
}

export function mapSkillPermissionToApi(permission: SkillPermissionWithUsers): SkillAccessPermissions {
    const mode = assertSkillPermissionMode(permission.access_permission_mode);
    const allowedUserIds = permission.allowedUsers.map((row) => row.user_id);
    return mapPermissionToApiCommon(mode, allowedUserIds);
}

export function canUserAccessSkillFromPermission(permission: SkillPermissionWithUsers, userId: string): boolean {
    const mode = assertSkillPermissionMode(permission.access_permission_mode);
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
    const mode = assertSkillPermissionMode(permission.access_permission_mode);
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
    const now = BigInt(Date.now());

    if (payload.mode === "everyone") {
        await prisma.$transaction(async (tx) => {
            await tx.skill_metadata.update({
                where: { skill_slug: slug },
                data: {
                    access_permission_mode: "everyone",
                    updated_at: now,
                }
            });

            await tx.skill_access_permission_users.deleteMany({
                where: { skill_slug: slug }
            });
        });

        return getSkillAccessPermissionWithUsers(slug);
    }

    const existingUserIds = await resolveRestrictedPermissionUserIds(payload.allowed_user_ids, ownerUserId);

    await prisma.$transaction(async (tx) => {
        await tx.skill_metadata.update({
            where: { skill_slug: slug },
            data: {
                access_permission_mode: "restricted",
                updated_at: now,
            }
        });

        await tx.skill_access_permission_users.deleteMany({
            where: { skill_slug: slug }
        });

        await tx.skill_access_permission_users.createMany({
            data: existingUserIds.map((userId) => ({
                skill_slug: slug,
                user_id: userId,
                created_at: now,
            }))
        });
    });

    return getSkillAccessPermissionWithUsers(slug);
}

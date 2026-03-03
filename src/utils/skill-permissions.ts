import prisma from "../prisma/client";
import { SkillAccessPermissions, SkillAccessPermissionMode } from "../types/skill";

type SkillPermissionWithUsers = {
    skill_slug: string;
    access_permission_mode: string;
    allowedUsers: Array<{ user_id: string; user: { id: string; name: string; email: string } }>;
};

function assertSkillPermissionMode(mode: string): SkillAccessPermissionMode {
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 500,
            message: `Invalid skill access permission mode: ${mode}`
        };
    }
    return mode;
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
    if (mode === "everyone") {
        return { mode: "everyone" };
    }
    return {
        mode: "restricted",
        allowed_user_ids: permission.allowedUsers.map((row) => row.user_id),
    };
}

export function canUserAccessSkillFromPermission(permission: SkillPermissionWithUsers, userId: string): boolean {
    const mode = assertSkillPermissionMode(permission.access_permission_mode);
    if (mode === "everyone") return true;
    return permission.allowedUsers.some((row) => row.user_id === userId);
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
    const canUse = canUserAccessSkillFromPermission(permission, currentUserId);
    const allowedCount = mode === "restricted" ? permission.allowedUsers.length : 0;
    const isLocked = mode === "restricted" && permission.allowedUsers.length === 0;

    return {
        access_permission_mode: mode,
        can_current_user_use_skill: canUse,
        can_current_user_manage_access_permissions: canUse,
        allowed_user_count: allowedCount,
        is_access_locked_due_to_missing_users: isLocked,
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

    let dedupedUserIds = Array.from(new Set(payload.allowed_user_ids));

    if (ownerUserId && !dedupedUserIds.includes(ownerUserId)) {
        dedupedUserIds = [...dedupedUserIds, ownerUserId];
    }
    if (dedupedUserIds.length === 0) {
        throw {
            status: 400,
            message: "restricted permissions require at least one allowed user"
        };
    }

    const existingUsers = await prisma.users.findMany({
        where: { id: { in: dedupedUserIds } },
        select: { id: true }
    });
    if (existingUsers.length !== dedupedUserIds.length) {
        throw {
            status: 400,
            message: "One or more selected users do not exist"
        };
    }

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
            data: dedupedUserIds.map((userId) => ({
                skill_slug: slug,
                user_id: userId,
                created_at: now,
            }))
        });
    });

    return getSkillAccessPermissionWithUsers(slug);
}

import prisma from "../prisma/client";

export type CommonPermissionMode = "restricted" | "everyone";

export function assertCommonPermissionMode(mode: string, label: string): CommonPermissionMode {
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 500,
            message: `Invalid ${label} permission mode: ${mode}`
        };
    }
    return mode;
}

export function mapPermissionToApiCommon(
    mode: CommonPermissionMode,
    allowedUserIds: string[],
): { mode: "everyone" } | { mode: "restricted"; allowed_user_ids: string[] } {
    if (mode === "everyone") {
        return { mode: "everyone" };
    }
    return {
        mode: "restricted",
        allowed_user_ids: allowedUserIds
    };
}

export function canUserUseFromMode(
    mode: CommonPermissionMode,
    allowedUserIds: string[],
    userId: string,
): boolean {
    if (mode === "everyone") return true;
    return allowedUserIds.includes(userId);
}

export function getCommonPermissionSummary(
    mode: CommonPermissionMode,
    allowedUserIds: string[],
    currentUserId: string,
): {
    canCurrentUserUse: boolean;
    allowedUserCount: number;
    isLockedDueToMissingUsers: boolean;
} {
    const canCurrentUserUse = canUserUseFromMode(mode, allowedUserIds, currentUserId);
    const allowedUserCount = mode === "restricted" ? allowedUserIds.length : 0;
    const isLockedDueToMissingUsers = mode === "restricted" && allowedUserIds.length === 0;
    return {
        canCurrentUserUse,
        allowedUserCount,
        isLockedDueToMissingUsers
    };
}

export async function getExistingUserIds(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true }
    });
    return users.map((user) => user.id);
}

export async function resolveRestrictedPermissionUserIds(
    allowedUserIds: string[],
    ownerUserId: string | null,
): Promise<string[]> {
    let dedupedUserIds = Array.from(new Set(allowedUserIds));

    if (ownerUserId) {
        const ownerExists = (await getExistingUserIds([ownerUserId])).length === 1;
        if (ownerExists && !dedupedUserIds.includes(ownerUserId)) {
            dedupedUserIds = [...dedupedUserIds, ownerUserId];
        }
    }

    if (dedupedUserIds.length === 0) {
        throw {
            status: 400,
            message: "restricted permissions require at least one allowed user"
        };
    }

    const existingUserIds = await getExistingUserIds(dedupedUserIds);
    if (existingUserIds.length !== dedupedUserIds.length) {
        throw {
            status: 400,
            message: "One or more selected users do not exist"
        };
    }

    return existingUserIds;
}

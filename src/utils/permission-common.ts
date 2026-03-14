import prisma from "../prisma/client";
import { PermissionMode, Permissions } from "../types/permissions";
import { Prisma } from "../../prisma/generated/client";

export type ResourceKind = "workflow" | "skill";

export type ResourcePermissionWithUsers = {
    resource_kind: string;
    resource_slug: string;
    permission_mode: string;
    allowedUsers: Array<{ user_id: string; user: { id: string; name: string; email: string } }>;
};

export function assertCommonPermissionMode(mode: string, label: string): PermissionMode {
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 500,
            message: `Invalid ${label} permission mode: ${mode}`
        };
    }
    return mode;
}

async function getExistingUserIds(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true }
    });
    return users.map((user) => user.id);
}

async function resolveRestrictedPermissionUserIds(
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

export async function getResourcePermissionWithUsers(
    resourceKind: ResourceKind,
    slug: string,
    notFoundLabel: string,
): Promise<ResourcePermissionWithUsers> {
    const permission = await prisma.resource_permissions.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        },
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
            message: `${notFoundLabel} permissions missing for ${notFoundLabel.toLowerCase()}: ${slug}`
        };
    }

    return permission as ResourcePermissionWithUsers;
}

export async function ensureResourcePermissions(
    resourceKind: ResourceKind,
    slug: string,
    candidateUserIds: string[],
): Promise<void> {
    const existing = await prisma.resource_permissions.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        },
        select: { resource_slug: true }
    });
    if (existing) return;

    const existingUserIds = await getExistingUserIds(Array.from(new Set(candidateUserIds)));
    const now = BigInt(Date.now());

    try {
        await prisma.resource_permissions.create({
            data: {
                resource_kind: resourceKind,
                resource_slug: slug,
                permission_mode: "restricted",
                created_at: now,
                updated_at: now,
                allowedUsers: existingUserIds.length > 0 ? {
                    createMany: {
                        data: existingUserIds.map((userId) => ({
                            user_id: userId,
                            created_at: now
                        }))
                    }
                } : undefined
            }
        });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            return;
        }
        throw err;
    }
}

export async function initializeResourcePermissionsForCreator(
    resourceKind: ResourceKind,
    slug: string,
    creatorUserId: string,
): Promise<void> {
    const existing = await prisma.resource_permissions.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        },
        select: { permission_mode: true }
    });

    const now = BigInt(Date.now());
    if (!existing) {
        await prisma.resource_permissions.create({
            data: {
                resource_kind: resourceKind,
                resource_slug: slug,
                permission_mode: "restricted",
                created_at: now,
                updated_at: now,
                allowedUsers: {
                    create: {
                        user_id: creatorUserId,
                        created_at: now
                    }
                }
            }
        });
        return;
    }

    if (existing.permission_mode === "restricted") {
        await prisma.resource_permissions.update({
            where: {
                resource_kind_resource_slug: {
                    resource_kind: resourceKind,
                    resource_slug: slug,
                }
            },
            data: {
                updated_at: now,
                allowedUsers: {
                    connectOrCreate: {
                        where: {
                            resource_kind_resource_slug_user_id: {
                                resource_kind: resourceKind,
                                resource_slug: slug,
                                user_id: creatorUserId,
                            }
                        },
                        create: {
                            user_id: creatorUserId,
                            created_at: now
                        }
                    }
                }
            }
        });
    }
}

export async function addUserToResourcePermissionsIfRestricted(
    resourceKind: ResourceKind,
    slug: string,
    userId: string,
    ownerUserId: string | null,
): Promise<void> {
    const permission = await prisma.resource_permissions.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        },
        select: { permission_mode: true }
    });

    if (!permission) {
        await ensureResourcePermissions(resourceKind, slug, [ownerUserId, userId].filter((id): id is string => Boolean(id)));
        return;
    }

    if (permission.permission_mode !== "restricted") {
        return;
    }

    const now = BigInt(Date.now());
    await prisma.resource_permissions.update({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        },
        data: {
            updated_at: now,
            allowedUsers: {
                connectOrCreate: {
                    where: {
                        resource_kind_resource_slug_user_id: {
                            resource_kind: resourceKind,
                            resource_slug: slug,
                            user_id: userId,
                        }
                    },
                    create: {
                        user_id: userId,
                        created_at: now
                    }
                }
            }
        }
    });
}

export async function setResourcePermissions(
    resourceKind: ResourceKind,
    slug: string,
    payload: Permissions,
    ownerUserId: string | null,
): Promise<ResourcePermissionWithUsers> {
    const now = BigInt(Date.now());

    if (payload.mode === "everyone") {
        await prisma.$transaction(async (tx) => {
            await tx.resource_permissions.update({
                where: {
                    resource_kind_resource_slug: {
                        resource_kind: resourceKind,
                        resource_slug: slug,
                    }
                },
                data: {
                    permission_mode: "everyone",
                    updated_at: now
                }
            });
            await tx.resource_permission_users.deleteMany({
                where: {
                    resource_kind: resourceKind,
                    resource_slug: slug,
                }
            });
        });
        return getResourcePermissionWithUsers(resourceKind, slug, resourceKind === "workflow" ? "Workflow run" : "Skill access");
    }

    const existingUserIds = await resolveRestrictedPermissionUserIds(payload.allowed_user_ids, ownerUserId);
    await prisma.$transaction(async (tx) => {
        await tx.resource_permissions.update({
            where: {
                resource_kind_resource_slug: {
                    resource_kind: resourceKind,
                    resource_slug: slug,
                }
            },
            data: {
                permission_mode: "restricted",
                updated_at: now
            }
        });

        await tx.resource_permission_users.deleteMany({
            where: {
                resource_kind: resourceKind,
                resource_slug: slug,
            }
        });

        await tx.resource_permission_users.createMany({
            data: existingUserIds.map((userId) => ({
                resource_kind: resourceKind,
                resource_slug: slug,
                user_id: userId,
                created_at: now
            }))
        });
    });

    return getResourcePermissionWithUsers(resourceKind, slug, resourceKind === "workflow" ? "Workflow run" : "Skill access");
}

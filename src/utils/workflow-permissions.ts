import { Prisma } from "@prisma/client";
import prisma from "../prisma/client";
import { WorkflowMetadata, WorkflowRunPermissionMode, WorkflowRunPermissions } from "../types/workflow";

type PermissionWithUsers = {
    workflow_slug: string;
    run_permission_mode: string;
    allowedUsers: Array<{ user_id: string; user: { id: string; name: string; email: string } }>;
};

function assertPermissionMode(mode: string): WorkflowRunPermissionMode {
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 500,
            message: `Invalid workflow run permission mode: ${mode}`
        };
    }
    return mode;
}

function getDefaultCandidateUserIds(metadata: WorkflowMetadata): string[] {
    const ids = [metadata.created_by_user_id, metadata.approved_by_user_id].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
}

async function getExistingUserIds(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true }
    });
    return users.map((user) => user.id);
}

async function createRestrictedPermissionRow(slug: string, userIds: string[]): Promise<void> {
    const now = BigInt(Date.now());
    await prisma.workflow_metadata.create({
        data: {
            workflow_slug: slug,
            run_permission_mode: "restricted",
            created_at: now,
            updated_at: now,
            allowedUsers: userIds.length > 0 ? {
                createMany: {
                    data: userIds.map((userId) => ({
                        user_id: userId,
                        created_at: now
                    }))
                }
            } : undefined
        }
    });
}

export async function ensureWorkflowRunPermissionsForMetadata(slug: string, metadata: WorkflowMetadata): Promise<void> {
    const existing = await prisma.workflow_metadata.findUnique({
        where: { workflow_slug: slug },
        select: { workflow_slug: true }
    });
    if (existing) return;

    const candidateUserIds = getDefaultCandidateUserIds(metadata);
    const existingUserIds = await getExistingUserIds(candidateUserIds);

    try {
        await createRestrictedPermissionRow(slug, existingUserIds);
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            return;
        }
        throw err;
    }
}

export async function initializeWorkflowRunPermissionsForCreator(slug: string, creatorUserId: string): Promise<void> {
    const existing = await prisma.workflow_metadata.findUnique({
        where: { workflow_slug: slug },
        select: { run_permission_mode: true }
    });

    const now = BigInt(Date.now());
    if (!existing) {
        await prisma.workflow_metadata.create({
            data: {
                workflow_slug: slug,
                run_permission_mode: "restricted",
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

    if (existing.run_permission_mode === "restricted") {
        await prisma.workflow_metadata.update({
            where: { workflow_slug: slug },
            data: {
                updated_at: now,
                allowedUsers: {
                    connectOrCreate: {
                        where: {
                            workflow_slug_user_id: {
                                workflow_slug: slug,
                                user_id: creatorUserId
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

export async function addApproverToWorkflowRunPermissionsIfRestricted(
    slug: string,
    approverUserId: string,
    ownerUserId: string | null,
): Promise<void> {
    const permission = await prisma.workflow_metadata.findUnique({
        where: { workflow_slug: slug },
        select: { run_permission_mode: true }
    });
    if (!permission) {
        const now = BigInt(Date.now());
        const initialUserIds = await getExistingUserIds(Array.from(new Set(
            [ownerUserId, approverUserId].filter((id): id is string => Boolean(id))
        )));
        await prisma.workflow_metadata.create({
            data: {
                workflow_slug: slug,
                run_permission_mode: "restricted",
                created_at: now,
                updated_at: now,
                allowedUsers: initialUserIds.length > 0 ? {
                    createMany: {
                        data: initialUserIds.map((userId) => ({
                            user_id: userId,
                            created_at: now
                        }))
                    }
                } : undefined
            }
        });
        return;
    }

    if (permission.run_permission_mode !== "restricted") {
        return;
    }

    const now = BigInt(Date.now());
    await prisma.workflow_metadata.update({
        where: { workflow_slug: slug },
        data: {
            updated_at: now,
            allowedUsers: {
                connectOrCreate: {
                    where: {
                        workflow_slug_user_id: {
                            workflow_slug: slug,
                            user_id: approverUserId
                        }
                    },
                    create: {
                        user_id: approverUserId,
                        created_at: now
                    }
                }
            }
        }
    });
}

export async function getWorkflowRunPermissionWithUsers(slug: string): Promise<PermissionWithUsers> {
    const permission = await prisma.workflow_metadata.findUnique({
        where: { workflow_slug: slug },
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
            message: `Workflow run permissions missing for workflow: ${slug}`
        };
    }

    return permission as PermissionWithUsers;
}

export function mapPermissionToApi(permission: PermissionWithUsers): WorkflowRunPermissions {
    const mode = assertPermissionMode(permission.run_permission_mode);
    if (mode === "everyone") {
        return { mode: "everyone" };
    }
    return {
        mode: "restricted",
        allowed_user_ids: permission.allowedUsers.map((row) => row.user_id)
    };
}

export function canUserRunWorkflowFromPermission(permission: PermissionWithUsers, userId: string): boolean {
    const mode = assertPermissionMode(permission.run_permission_mode);
    if (mode === "everyone") return true;
    return permission.allowedUsers.some((row) => row.user_id === userId);
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
    const mode = assertPermissionMode(permission.run_permission_mode);
    const canRun = canUserRunWorkflowFromPermission(permission, currentUserId);
    const allowedCount = mode === "restricted" ? permission.allowedUsers.length : 0;
    const isLocked = mode === "restricted" && permission.allowedUsers.length === 0;

    return {
        run_permission_mode: mode,
        can_current_user_run: canRun,
        can_current_user_manage_run_permissions: canRun,
        allowed_runner_count: allowedCount,
        is_run_locked_due_to_missing_users: isLocked
    };
}

export async function setWorkflowRunPermissions(
    slug: string,
    payload: WorkflowRunPermissions,
    ownerUserId: string | null,
): Promise<PermissionWithUsers> {
    const now = BigInt(Date.now());

    if (payload.mode === "everyone") {
        await prisma.$transaction(async (tx) => {
            await tx.workflow_metadata.upsert({
                where: { workflow_slug: slug },
                create: {
                    workflow_slug: slug,
                    run_permission_mode: "everyone",
                    created_at: now,
                    updated_at: now
                },
                update: {
                    run_permission_mode: "everyone",
                    updated_at: now
                }
            });
            await tx.workflow_run_permission_users.deleteMany({
                where: { workflow_slug: slug }
            });
        });
        return getWorkflowRunPermissionWithUsers(slug);
    }

    let dedupedUserIds = Array.from(new Set(payload.allowed_user_ids));

    let ownerExists = false;
    if (ownerUserId) {
        const owner = await prisma.users.findUnique({
            where: { id: ownerUserId },
            select: { id: true }
        });
        ownerExists = owner !== null;
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

    await prisma.$transaction(async (tx) => {
        await tx.workflow_metadata.upsert({
            where: { workflow_slug: slug },
            create: {
                workflow_slug: slug,
                run_permission_mode: "restricted",
                created_at: now,
                updated_at: now
            },
            update: {
                run_permission_mode: "restricted",
                updated_at: now
            }
        });

        await tx.workflow_run_permission_users.deleteMany({
            where: { workflow_slug: slug }
        });

        await tx.workflow_run_permission_users.createMany({
            data: existingUserIds.map((userId) => ({
                workflow_slug: slug,
                user_id: userId,
                created_at: now
            }))
        });
    });

    return getWorkflowRunPermissionWithUsers(slug);
}

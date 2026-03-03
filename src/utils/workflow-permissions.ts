import { Prisma } from "@prisma/client";
import prisma from "../prisma/client";
import { WorkflowMetadata, WorkflowRunPermissionMode, WorkflowRunPermissions } from "../types/workflow";
import {
    assertCommonPermissionMode,
    canUserUseFromMode,
    getCommonPermissionSummary,
    getExistingUserIds,
    mapPermissionToApiCommon,
    resolveRestrictedPermissionUserIds,
} from "./permission-common";

type PermissionWithUsers = {
    workflow_slug: string;
    run_permission_mode: string;
    allowedUsers: Array<{ user_id: string; user: { id: string; name: string; email: string } }>;
};

function assertPermissionMode(mode: string): WorkflowRunPermissionMode {
    return assertCommonPermissionMode(mode, "workflow run");
}

function getDefaultCandidateUserIds(metadata: WorkflowMetadata): string[] {
    const ids = [metadata.created_by_user_id, metadata.approved_by_user_id].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
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
    const allowedUserIds = permission.allowedUsers.map((row) => row.user_id);
    return mapPermissionToApiCommon(mode, allowedUserIds);
}

export function canUserRunWorkflowFromPermission(permission: PermissionWithUsers, userId: string): boolean {
    const mode = assertPermissionMode(permission.run_permission_mode);
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
    const mode = assertPermissionMode(permission.run_permission_mode);
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
    const now = BigInt(Date.now());

    if (payload.mode === "everyone") {
        await prisma.$transaction(async (tx) => {
            await tx.workflow_metadata.update({
                where: { workflow_slug: slug },
                data: {
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

    const existingUserIds = await resolveRestrictedPermissionUserIds(payload.allowed_user_ids, ownerUserId);

    await prisma.$transaction(async (tx) => {
        await tx.workflow_metadata.update({
            where: { workflow_slug: slug },
            data: {
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

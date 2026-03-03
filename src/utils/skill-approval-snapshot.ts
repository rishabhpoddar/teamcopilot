import prisma from "../prisma/client";

export interface SkillSnapshotApprovalState {
    has_approved_snapshot: boolean;
    is_current_code_approved: boolean;
}

export async function getSkillSnapshotApprovalState(slug: string): Promise<SkillSnapshotApprovalState> {
    const approvedSnapshot = await prisma.resource_approved_snapshots.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: "skill",
                resource_slug: slug
            }
        },
        select: { resource_slug: true }
    });

    const hasApprovedSnapshot = Boolean(approvedSnapshot);
    return {
        has_approved_snapshot: hasApprovedSnapshot,
        is_current_code_approved: hasApprovedSnapshot,
    };
}

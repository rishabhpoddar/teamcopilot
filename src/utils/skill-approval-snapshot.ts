import type { WorkflowApprovalDiffResponse, WorkflowSnapshot } from "../types/workflow";
import { getSkillPath, readSkillManifestAndEnsurePermissions } from "./skill";
import {
    approveResourceWithSnapshot,
    buildApprovalDiffResponse,
    collectCurrentResourceSnapshot,
    getResourceSnapshotApprovalState,
    loadApprovedSnapshotFromDb as loadApprovedSnapshotFromDbCommon,
    restoreResourceToApprovedSnapshot,
} from "./approval-snapshot-common";

function getSkillSnapshotConfig(slug: string) {
    return {
        resource_kind: "skill" as const,
        slug,
        resource_label: "skill",
        root_path: getSkillPath(slug),
        ensure_resource_exists: async () => {
            await readSkillManifestAndEnsurePermissions(slug);
        }
    };
}

export function collectCurrentSkillSnapshot(slug: string): WorkflowSnapshot {
    return collectCurrentResourceSnapshot(getSkillSnapshotConfig(slug));
}

export async function loadApprovedSkillSnapshotFromDb(slug: string): Promise<WorkflowSnapshot | null> {
    return loadApprovedSnapshotFromDbCommon("skill", slug);
}

export async function approveSkillWithSnapshot(slug: string, userId: string): Promise<{ approved_by_user_id: string; snapshot_hash: string; snapshot_file_count: number }> {
    return approveResourceWithSnapshot(getSkillSnapshotConfig(slug), userId);
}

export function buildSkillApprovalDiffResponse(previous: WorkflowSnapshot | null, current: WorkflowSnapshot): WorkflowApprovalDiffResponse {
    return buildApprovalDiffResponse(previous, current);
}

export async function getSkillSnapshotApprovalState(slug: string) {
    return getResourceSnapshotApprovalState(getSkillSnapshotConfig(slug));
}

export async function restoreSkillToApprovedSnapshot(slug: string, userId: string): Promise<{ restored_file_count: number; snapshot_hash: string }> {
    return restoreResourceToApprovedSnapshot(getSkillSnapshotConfig(slug), userId);
}

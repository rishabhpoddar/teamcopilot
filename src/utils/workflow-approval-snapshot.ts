import type { WorkflowSnapshot } from "../types/workflow";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";
import { getWorkflowPath } from "./workflow";
import {
    approveResourceWithSnapshot,
    buildApprovalDiffResponse,
    collectCurrentResourceSnapshot,
    getResourceSnapshotApprovalState,
    loadApprovedSnapshotFromDb as loadApprovedSnapshotFromDbCommon,
    restoreResourceToApprovedSnapshot,
} from "./approval-snapshot-common";

function getWorkflowSnapshotConfig(slug: string) {
    return {
        resource_kind: "workflow" as const,
        slug,
        resource_label: "workflow",
        root_path: getWorkflowPath(slug),
        ensure_resource_exists: async () => {
            await readWorkflowManifestAndEnsurePermissions(slug);
        }
    };
}

export function collectCurrentWorkflowSnapshot(slug: string): WorkflowSnapshot {
    return collectCurrentResourceSnapshot(getWorkflowSnapshotConfig(slug));
}

export async function loadApprovedSnapshotFromDb(slug: string): Promise<WorkflowSnapshot | null> {
    return loadApprovedSnapshotFromDbCommon("workflow", slug);
}

export async function approveWorkflowWithSnapshot(slug: string, userId: string): Promise<{ approved_by_user_id: string; snapshot_hash: string; snapshot_file_count: number }> {
    return approveResourceWithSnapshot(getWorkflowSnapshotConfig(slug), userId);
}

export { buildApprovalDiffResponse };

export async function getWorkflowSnapshotApprovalState(slug: string) {
    return getResourceSnapshotApprovalState(getWorkflowSnapshotConfig(slug));
}

export async function restoreWorkflowToApprovedSnapshot(slug: string, userId: string): Promise<{ restored_file_count: number; snapshot_hash: string }> {
    return restoreResourceToApprovedSnapshot(getWorkflowSnapshotConfig(slug), userId);
}

import type { WorkflowApprovalDiffFile, WorkflowApprovalDiffSummary } from "../../../src/types/shared/workflow";

export function summarizeDiffFiles(files: WorkflowApprovalDiffFile[]): WorkflowApprovalDiffSummary {
    return files.reduce<WorkflowApprovalDiffSummary>((summary, file) => {
        if (file.status === "added") {
            summary.added += 1;
        }
        if (file.status === "modified") {
            summary.modified += 1;
        }
        if (file.status === "deleted") {
            summary.deleted += 1;
        }
        if (file.kind === "text") {
            summary.text_files += 1;
        } else {
            summary.binary_files += 1;
        }
        return summary;
    }, {
        added: 0,
        modified: 0,
        deleted: 0,
        text_files: 0,
        binary_files: 0,
    });
}

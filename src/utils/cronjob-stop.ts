import prisma from "../prisma/client";
import { abortOpencodeSession } from "./session-abort";
import { markWorkflowSessionAborted } from "./workflow-interruption";

function nowMs(): bigint {
    return BigInt(Date.now());
}

interface CronjobRunStopTarget {
    id: string;
    opencode_session_id: string | null;
    workflow_run_id: string | null;
    status: string;
}

export async function stopCronjobRun(run: CronjobRunStopTarget): Promise<void> {
    if (run.status !== "running") {
        return;
    }

    if (run.opencode_session_id) {
        await abortOpencodeSession(run.opencode_session_id);
    }

    if (run.workflow_run_id) {
        const workflowRun = await prisma.workflow_runs.findUnique({
            where: { id: run.workflow_run_id },
            select: { session_id: true },
        });
        if (workflowRun?.session_id) {
            await markWorkflowSessionAborted(workflowRun.session_id);
        }
    }

    await prisma.cronjob_runs.update({
        where: { id: run.id },
        data: {
            status: "failed",
            completed_at: nowMs(),
            error_message: "Cronjob run was stopped by the user.",
        },
    });
}

import prisma from "../prisma/client";

function nowMs(): bigint {
    return BigInt(Date.now());
}

export async function reconcileRunningWorkflowRunsOnStartup(): Promise<void> {
    const runningWorkflowRuns = await prisma.workflow_runs.findMany({
        where: { status: "running" },
        select: { id: true },
    });
    if (runningWorkflowRuns.length === 0) return;

    const runIds = runningWorkflowRuns.map((run) => run.id);
    const completedAt = nowMs();
    const workflowError = "Workflow run was interrupted because the backend restarted.";
    const cronjobError = "Workflow cronjob run was interrupted because the backend restarted.";

    await prisma.workflow_runs.updateMany({
        where: { id: { in: runIds }, status: "running" },
        data: {
            status: "failed",
            completed_at: completedAt,
            error_message: workflowError,
        },
    });

    await prisma.cronjob_runs.updateMany({
        where: {
            workflow_run_id: { in: runIds },
            status: "running",
        },
        data: {
            status: "failed",
            completed_at: completedAt,
            error_message: cronjobError,
        },
    });
}

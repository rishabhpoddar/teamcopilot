import prisma from "../prisma/client";

export async function isWorkflowAllowedAlwaysInSession(
    opencodeSessionId: string,
    workflowSlug: string
): Promise<boolean> {
    const entry = await prisma.workflow_session_allowed_runs.findFirst({
        where: {
            opencode_session_id: opencodeSessionId,
            workflow_slug: workflowSlug,
        },
        select: {
            opencode_session_id: true,
        },
    });
    return entry !== null;
}

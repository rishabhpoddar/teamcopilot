import prisma from "../prisma/client";
import { getOpencodePort } from "./opencode-client";

export async function isWorkflowSessionInterrupted(sessionId: string, workspaceDir: string): Promise<boolean> {
    const isManualSession = sessionId.startsWith("manual-");
    if (isManualSession) {
        const aborted = await prisma.workflow_aborted_sessions.findUnique({
            where: { session_id: sessionId }
        });
        return Boolean(aborted);
    }

    const port = getOpencodePort();
    const response = await fetch(`http://localhost:${port}/session/status?directory=${encodeURIComponent(workspaceDir)}`);
    if (response.ok) {
        const statuses = await response.json() as Record<string, { type?: string }>;
        const state = statuses[sessionId] ?? null;
        const sessionType = typeof state?.type === "string" ? state.type : null;
        // Opencode may remove a session from this status map right after abort/interrupt.
        // If it is not explicitly "busy", treat it as interrupted.
        return sessionType !== "busy";
    }

    return false;
}

export async function markWorkflowSessionAborted(sessionId: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000);
    await prisma.workflow_aborted_sessions.deleteMany({
        where: {
            created_at: {
                lt: BigInt(cutoff)
            }
        }
    });

    await prisma.workflow_aborted_sessions.upsert({
        where: { session_id: sessionId },
        create: {
            session_id: sessionId,
            created_at: BigInt(now)
        },
        update: {
            created_at: BigInt(now)
        }
    });
}

export async function clearWorkflowSessionAborted(sessionId: string): Promise<void> {
    await prisma.workflow_aborted_sessions.deleteMany({
        where: { session_id: sessionId }
    });
}

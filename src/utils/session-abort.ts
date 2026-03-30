import prisma from "../prisma/client";
import { assertCondition } from "./assert";
import {
    getOpencodeClient,
    listPendingPermissionsForSession,
    getPendingQuestionForSession,
    replyToPendingPermission,
    replyToPendingQuestion
} from "./opencode-client";

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "detail" in error) {
        return String((error as { detail: unknown }).detail);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown error";
}

export async function abortOpencodeSession(opencodeSessionId: string): Promise<void> {
    const pendingQuestion = await getPendingQuestionForSession(opencodeSessionId);
    if (pendingQuestion) {
        const abortAnswer = "User aborted";
        const answers = pendingQuestion.questions.map(() => [abortAnswer]);
        await replyToPendingQuestion(pendingQuestion.id, answers);
    }

    const pendingPermissions = await listPendingPermissionsForSession(opencodeSessionId);
    for (const pendingPermission of pendingPermissions) {
        await replyToPendingPermission(opencodeSessionId, pendingPermission.id, "reject");
    }

    await prisma.tool_execution_permissions.updateMany({
        where: {
            opencode_session_id: opencodeSessionId,
            status: "pending"
        },
        data: {
            status: "rejected",
            responded_at: BigInt(Date.now())
        }
    });

    const client = await getOpencodeClient();
    const abortResult = await client.session.abort({
        path: { id: opencodeSessionId }
    });
    assertCondition(!abortResult.error, getErrorMessage(abortResult.error));
}

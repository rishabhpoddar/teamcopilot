import { getOpencodeClient } from "./opencode-client";
import type { SessionMessageWire } from "./chat-session";

const DEFAULT_MESSAGE_PAGE_LIMIT = 25;

type SessionMessagesPageQuery = {
    limit: number;
    before?: string;
};

type SessionMessagesPageResult = {
    messages: SessionMessageWire[];
    nextCursor: string | null;
    hasMore: boolean;
};

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "detail" in error) {
        return String((error as { detail: unknown }).detail);
    }
    return "Failed to get messages from opencode";
}

export function parseSessionMessagesPageQuery(query: {
    before?: unknown;
}): SessionMessagesPageQuery {
    const limit = DEFAULT_MESSAGE_PAGE_LIMIT;

    const rawBefore = query.before;
    if (rawBefore === undefined) {
        return { limit };
    }

    if (typeof rawBefore !== "string" || rawBefore.trim().length === 0) {
        throw {
            status: 400,
            message: "before must be a non-empty string",
        };
    }

    return {
        limit,
        before: rawBefore,
    };
}

export async function fetchOpencodeSessionMessagesPage(
    opencodeSessionId: string,
    pageQuery: SessionMessagesPageQuery
): Promise<SessionMessagesPageResult> {
    const client = await getOpencodeClient();
    const result = await client.session.messages({
        path: { id: opencodeSessionId },
        query: {
            limit: pageQuery.limit,
            ...(pageQuery.before ? { before: pageQuery.before } : {}),
        } as { limit: number; before?: string },
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error));
    }

    const nextCursor = result.response.headers.get("x-next-cursor");
    const hasMore = nextCursor !== null && nextCursor.length > 0;

    return {
        messages: result.data as SessionMessageWire[],
        nextCursor,
        hasMore,
    };
}

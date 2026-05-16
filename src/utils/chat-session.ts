import { assertCondition } from "./assert";
export type SessionStatusType = 'busy' | 'retry' | 'idle';
export type SessionStatusMap = Record<string, { type: 'busy' | 'retry' | 'idle' }>;

type PendingQuestionWire = {
    sessionID: string;
    tool?: {
        messageID: string;
    };
};

type PendingPermissionWire = {
    sessionID: string;
    tool?: {
        messageID: string;
    };
};

type CustomPendingPermissionWire = {
    opencode_session_id: string;
    message_id: string;
};

type ToolStateWire = {
    status: 'pending' | 'running' | 'completed' | 'error';
    input: Record<string, unknown>;
    error?: string;
    metadata?: Record<string, unknown>;
    time?: {
        start?: number;
        end?: number;
    };
};

type NonToolPartWire = {
    id: string;
    type: "text" | "reasoning" | "file" | "step-start" | "step-finish" | "agent";
    messageID: string;
};

type ToolPartWire = {
    id: string;
    type: "tool";
    tool: string;
    messageID: string;
    state: ToolStateWire;
};

type MessagePartWire = NonToolPartWire | ToolPartWire;

export type SessionMessageWire = {
    info: {
        id: string;
    };
    parts: MessagePartWire[];
};

export function getSessionStatusTypeForSession(
    statusMap: SessionStatusMap,
    sessionId: string
): SessionStatusType {
    const status = statusMap[sessionId];
    return status ? status.type : 'idle';
}

export function sessionHasPendingInputForLatestAssistantMessage(args: {
    opencodeSessionId: string;
    latestAssistantMessageId: string | null;
    pendingQuestions: PendingQuestionWire[];
    pendingPermissions: PendingPermissionWire[];
    customPendingPermissions: CustomPendingPermissionWire[];
}): boolean {
    if (args.latestAssistantMessageId === null) {
        return false;
    }

    return (
        args.pendingQuestions.some((question) =>
            question.sessionID === args.opencodeSessionId
            && question.tool?.messageID === args.latestAssistantMessageId
        )
        || args.pendingPermissions.some((permission) =>
            permission.sessionID === args.opencodeSessionId
            && permission.tool?.messageID === args.latestAssistantMessageId
        )
        || args.customPendingPermissions.some((permission) =>
            permission.opencode_session_id === args.opencodeSessionId
            && permission.message_id === args.latestAssistantMessageId
        )
    );
}

export function normalizeStaleRunningTools(
    messages: SessionMessageWire[],
    sessionStatusType: SessionStatusType
): SessionMessageWire[] {
    const isSessionBusy = sessionStatusType === 'busy' || sessionStatusType === 'retry';
    if (isSessionBusy) {
        return messages;
    }

    const now = Date.now();

    return messages.map((container) => {
        const nextParts = container.parts.map((part) => {
            if (part.type !== 'tool') return part;
            if (part.state.status !== 'running' && part.state.status !== 'pending') return part;

            assertCondition(
                typeof part.state.time?.start === 'number',
                `Missing tool start time for part '${part.id}' in message '${part.messageID}'`
            );
            const runningStart = part.state.time.start;
            const normalizedState: ToolStateWire = {
                status: 'error',
                input: part.state.input,
                error: 'Tool call interrupted',
                metadata: part.state.metadata,
                time: {
                    start: runningStart,
                    end: now
                }
            };
            return {
                ...part,
                state: normalizedState
            };
        });

        return {
            info: container.info,
            parts: nextParts
        };
    });
}

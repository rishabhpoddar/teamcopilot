export type SessionStatusType = 'busy' | 'retry' | 'idle';
export type SessionStatusMap = Record<string, { type: 'busy' | 'retry' | 'idle' }>;

export type ToolStateWire = {
    status: 'pending' | 'running' | 'completed' | 'error';
    input: Record<string, unknown>;
    error?: string;
    metadata?: Record<string, unknown>;
    time?: {
        start?: number;
        end?: number;
    };
};

export type NonToolPartWire = {
    id: string;
    type: "text" | "reasoning" | "file" | "step-start" | "step-finish" | "agent";
    messageID: string;
};

export type ToolPartWire = {
    id: string;
    type: "tool";
    tool: string;
    messageID: string;
    state: ToolStateWire;
};

export type MessagePartWire = NonToolPartWire | ToolPartWire;

export type SessionMessageWire = {
    info: {
        id: string;
    };
    parts: MessagePartWire[];
};

export function assertCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw {
            status: 500,
            message
        };
    }
}

export function getSessionStatusTypeForSession(
    statusMap: SessionStatusMap,
    sessionId: string
): SessionStatusType {
    const status = statusMap[sessionId];
    return status ? status.type : 'idle';
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

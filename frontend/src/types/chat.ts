// Session type for our local database
export interface ChatSession {
    id: string;
    opencode_session_id: string;
    title: string | null;
    created_at: number;
    updated_at: number;
}

// Message types from opencode SDK
export interface UserMessage {
    id: string;
    sessionID: string;
    role: "user";
    time: {
        created: number;
    };
    summary?: {
        title?: string;
        body?: string;
    };
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
}

export interface AssistantMessage {
    id: string;
    sessionID: string;
    role: "assistant";
    time: {
        created: number;
        completed?: number;
    };
    error?: MessageError;
    parentID: string;
    modelID: string;
    providerID: string;
    mode?: string;
    path?: {
        cwd: string;
        root: string;
    };
    summary?: boolean;
    cost?: number;
    tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache: {
            read: number;
            write: number;
        };
    };
    finish?: string;
}

export interface MessageError {
    name: string;
    data: {
        message?: string;
        [key: string]: unknown;
    };
}

export type Message = UserMessage | AssistantMessage;

// Part types
export interface TextPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "text";
    text: string;
    synthetic?: boolean;
    ignored?: boolean;
    time?: {
        start: number;
        end?: number;
    };
}

export interface ReasoningPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "reasoning";
    text: string;
    time: {
        start: number;
        end?: number;
    };
}

export interface FilePart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "file";
    mime: string;
    filename?: string;
    url: string;
}

export interface ToolStatePending {
    status: "pending";
    input: Record<string, unknown>;
    raw?: string;
}

export interface ToolStateRunning {
    status: "running";
    input: Record<string, unknown>;
    title?: string;
    metadata?: Record<string, unknown>;
    time: {
        start: number;
    };
}

export interface ToolStateCompleted {
    status: "completed";
    input: Record<string, unknown>;
    output: string;
    title: string;
    metadata: Record<string, unknown>;
    time: {
        start: number;
        end: number;
        compacted?: number;
    };
}

export interface ToolStateError {
    status: "error";
    input: Record<string, unknown>;
    error: string;
    metadata?: Record<string, unknown>;
    time: {
        start: number;
        end: number;
    };
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

export interface ToolPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: string;
    state: ToolState;
    metadata?: Record<string, unknown>;
}

export interface StepStartPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-start";
    snapshot?: string;
}

export interface StepFinishPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-finish";
    reason: string;
    snapshot?: string;
    cost?: number;
    tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache: {
            read: number;
            write: number;
        };
    };
}

export interface AgentPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "agent";
    name: string;
}

export type Part = TextPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | AgentPart;

// Event types from SSE
export interface MessageUpdatedEvent {
    type: "message.updated";
    properties: {
        info: Message;
    };
}

export interface MessageRemovedEvent {
    type: "message.removed";
    properties: {
        sessionID: string;
        messageID: string;
    };
}

export interface MessagePartUpdatedEvent {
    type: "message.part.updated";
    properties: {
        part: Part;
        delta?: string;
    };
}

export interface MessagePartRemovedEvent {
    type: "message.part.removed";
    properties: {
        sessionID: string;
        messageID: string;
        partID: string;
    };
}

export interface ErrorEvent {
    type: "error";
    message: string;
}

export interface SessionStatusEvent {
    type: "session.status";
    properties: {
        sessionID: string;
        status: {
            type: string;
            [key: string]: unknown;
        };
    };
}

export interface SessionErrorEvent {
    type: "session.error";
    properties: {
        sessionID: string;
        error: {
            name: string;
            data: {
                message?: string;
                [key: string]: unknown;
            };
        };
    };
}

export interface SessionIdleEvent {
    type: "session.idle";
    properties: {
        sessionID: string;
    };
}

export type SSEEvent = MessageUpdatedEvent | MessageRemovedEvent | MessagePartUpdatedEvent | MessagePartRemovedEvent | ErrorEvent | SessionStatusEvent | SessionErrorEvent | SessionIdleEvent;

// API response types
export interface SessionsResponse {
    sessions: ChatSession[];
}

export interface SessionResponse {
    session: ChatSession & {
        opencode_data?: unknown;
    };
}

export interface MessagesResponse {
    messages: Message[];
}

// Helper to check message role
export function isUserMessage(message: Message): message is UserMessage {
    return message.role === "user";
}

export function isAssistantMessage(message: Message): message is AssistantMessage {
    return message.role === "assistant";
}

// Helper to check part type
export function isTextPart(part: Part): part is TextPart {
    return part.type === "text";
}

export function isToolPart(part: Part): part is ToolPart {
    return part.type === "tool";
}

export function isReasoningPart(part: Part): part is ReasoningPart {
    return part.type === "reasoning";
}

export function isFilePart(part: Part): part is FilePart {
    return part.type === "file";
}

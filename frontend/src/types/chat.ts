import type { WorkflowApprovalDiffResponse } from "../../../src/types/shared/workflow";

type ChatSessionBase = {
    id: string;
    opencode_session_id: string;
    title: string | null;
    created_at: number;
    updated_at: number;
    cronjob_handoff: {
        run_id: string;
        state: "waiting" | "interactive";
    } | null;
};

export type ChatSession =
    | (ChatSessionBase & {
        state: "attention";
        latest_message_id: string;
    })
    | (ChatSessionBase & {
        state: "idle" | "processing";
        latest_message_id: string | null;
    });

// Message types from opencode SDK
interface UserMessage {
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

interface AssistantMessage {
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

interface MessageError {
    name: string;
    data: {
        message?: string;
        [key: string]: unknown;
    };
}

export type Message = UserMessage | AssistantMessage;

// Part types
interface TextPart {
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

interface ReasoningPart {
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

interface FilePart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "file";
    mime: string;
    filename?: string;
    url: string;
}

interface ToolStatePending {
    status: "pending";
    input: Record<string, unknown>;
    raw?: string;
}

interface ToolStateRunning {
    status: "running";
    input: Record<string, unknown>;
    title?: string;
    metadata?: Record<string, unknown>;
    time: {
        start: number;
    };
}

interface ToolStateCompleted {
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

interface ToolStateError {
    status: "error";
    input: Record<string, unknown>;
    error: string;
    metadata?: Record<string, unknown>;
    time: {
        start: number;
        end: number;
    };
}

type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

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

interface StepStartPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "step-start";
    snapshot?: string;
}

interface StepFinishPart {
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

interface AgentPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "agent";
    name: string;
}

export type Part = TextPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | AgentPart;

// Event types from SSE
interface MessageUpdatedEvent {
    type: "message.updated";
    properties: {
        info: Message;
    };
}

interface MessageRemovedEvent {
    type: "message.removed";
    properties: {
        sessionID: string;
        messageID: string;
    };
}

interface MessagePartUpdatedEvent {
    type: "message.part.updated";
    properties: {
        part: Part;
        delta?: string;
    };
}

interface MessagePartRemovedEvent {
    type: "message.part.removed";
    properties: {
        sessionID: string;
        messageID: string;
        partID: string;
    };
}

interface ErrorEvent {
    type: "error";
    message: string;
}

interface SessionStatusEvent {
    type: "session.status";
    properties: {
        sessionID: string;
        status: {
            type: string;
            [key: string]: unknown;
        };
    };
}

interface SessionErrorEvent {
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

interface SessionIdleEvent {
    type: "session.idle";
    properties: {
        sessionID: string;
    };
}

export interface PermissionRequest {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
    always: string[];
    tool: {
        messageID: string;
        callID: string;
    };
}

export type ChatSessionDiffResponse = WorkflowApprovalDiffResponse;

interface PermissionAskedEvent {
    type: "permission.asked";
    properties: PermissionRequest;
}

interface PermissionRepliedEvent {
    type: "permission.replied";
    properties: {
        sessionID: string;
        requestID: string;
        reply: "once" | "always" | "reject";
    };
}

export type SSEEvent =
    MessageUpdatedEvent |
    MessageRemovedEvent |
    MessagePartUpdatedEvent |
    MessagePartRemovedEvent |
    ErrorEvent |
    SessionStatusEvent |
    SessionErrorEvent |
    SessionIdleEvent |
    PermissionAskedEvent |
    PermissionRepliedEvent;

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

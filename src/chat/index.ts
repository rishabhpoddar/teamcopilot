import express from "express";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";
import {
    getOpencodeClient,
    getPendingQuestionForSession,
    listPendingQuestions,
    listPendingPermissionsForSession,
    listPendingPermissions,
    getWorkspaceDir,
    getOpencodePort,
    replyToPendingQuestion,
    replyToPendingPermission
} from "../utils/opencode-client";
import {
    getSessionStatusTypeForSession,
    normalizeStaleRunningTools,
    sessionHasPendingInputForLatestAssistantMessage,
    type SessionMessageWire,
    type SessionStatusMap,
    type SessionStatusType
} from "../utils/chat-session";
import { assertCondition } from "../utils/assert";
import { sanitizeForClient } from "../utils/redact";
import { abortOpencodeSession } from "../utils/session-abort";
import {
    buildChatSessionFileDiffResponse,
    captureCurrentFileBaseline,
    normalizeWorkspaceRelativePath,
} from "../utils/chat-session-file-diff";
import { syncChatSessionUsage } from "../utils/chat-usage";
import { stopCronjobRun } from "../utils/cronjob-stop";
import {
    ACTUAL_USER_MESSAGE_MARKER,
    buildAvailableSecretsPrompt,
    buildAvailableSkillsPrompt,
} from "../utils/chat-prompt-context";

const router = express.Router({ mergeParams: true });
const USER_INSTRUCTIONS_FILENAME = "USER_INSTRUCTIONS.md";

function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'detail' in error) {
        return String((error as { detail: unknown }).detail);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unknown error';
}

interface ChatTextPartInput {
    type: "text";
    text: string;
}

interface ChatFilePartInput {
    type: "file";
    path: string;
}

type ChatMessagePartInput = ChatTextPartInput | ChatFilePartInput;
type SessionMessageSummary = {
    info: {
        id: string;
        role: string;
        time: {
            created: number;
            completed?: number;
        };
    };
};

function parseMessageParts(rawParts: unknown): ChatMessagePartInput[] {
    if (!Array.isArray(rawParts)) {
        throw {
            status: 400,
            message: "parts must be an array"
        };
    }

    const parts: ChatMessagePartInput[] = [];
    for (const rawPart of rawParts) {
        if (!rawPart || typeof rawPart !== "object") {
            throw {
                status: 400,
                message: "Each part must be an object"
            };
        }

        const part = rawPart as Record<string, unknown>;
        if (part.type === "text") {
            if (typeof part.text !== "string") {
                throw {
                    status: 400,
                    message: "Text part requires a string text field"
                };
            }
            parts.push({ type: "text", text: part.text });
            continue;
        }

        if (part.type === "file") {
            if (typeof part.path !== "string") {
                throw {
                    status: 400,
                    message: "File part requires a string path field"
                };
            }
            parts.push({ type: "file", path: normalizeWorkspaceRelativePath(part.path) });
            continue;
        }

        throw {
            status: 400,
            message: `Unsupported part type: ${String(part.type)}`
        };
    }

    return parts;
}

function buildOpencodePromptParts(parts: ChatMessagePartInput[]): Array<TextPartInput | FilePartInput> {
    const workspaceDir = getWorkspaceDir();
    return parts.map((part): TextPartInput | FilePartInput => {
        if (part.type === "text") {
            return {
                type: "text",
                text: part.text
            };
        }

        const normalizedPath = normalizeWorkspaceRelativePath(part.path);
        const absolutePath = path.resolve(workspaceDir, normalizedPath);
        const relativeCheck = path.relative(workspaceDir, absolutePath);
        if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
            throw {
                status: 400,
                message: "file path must stay inside workspace"
            };
        }

        const filename = normalizedPath.endsWith("/")
            ? normalizedPath.slice(0, -1).split("/").pop() || normalizedPath
            : normalizedPath.split("/").pop() || normalizedPath;

        return {
            type: "file",
            mime: "text/plain",
            filename,
            url: pathToFileURL(absolutePath).href
        };
    });
}

async function readWorkspaceUserInstructions(): Promise<string | null> {
    const workspaceDir = getWorkspaceDir();
    const userInstructionsPath = path.join(workspaceDir, USER_INSTRUCTIONS_FILENAME);

    try {
        const content = await fs.readFile(userInstructionsPath, "utf-8");
        if (content.trim().length === 0) {
            return null;
        }
        return content;
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
            return null;
        }
        throw new Error(`Failed to read ${USER_INSTRUCTIONS_FILENAME}: ${nodeError.message}`);
    }
}

async function writeWorkspaceUserInstructions(content: string): Promise<void> {
    const workspaceDir = getWorkspaceDir();
    const userInstructionsPath = path.join(workspaceDir, USER_INSTRUCTIONS_FILENAME);
    try {
        await fs.writeFile(userInstructionsPath, content, "utf-8");
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        throw new Error(`Failed to write ${USER_INSTRUCTIONS_FILENAME}: ${nodeError.message}`);
    }
}

function stripTextBeforeActualUserMarker(text: string): string {
    const markerIndex = text.indexOf(ACTUAL_USER_MESSAGE_MARKER);
    if (markerIndex === -1) {
        return text;
    }
    return text.slice(markerIndex + ACTUAL_USER_MESSAGE_MARKER.length).replace(/^\s+/, "");
}

function sanitizeFirstUserMessageForClient(messages: SessionMessageWire[]): SessionMessageWire[] {
    const firstUserMessageId = messages.find((message) => {
        const info = message.info as { role?: string };
        return info.role === "user";
    })?.info.id;

    if (!firstUserMessageId) {
        return messages;
    }

    const firstUserMessage = messages.find((message) => message.info.id === firstUserMessageId);
    if (!firstUserMessage) {
        return messages;
    }

    const hasMarker = firstUserMessage.parts.some((part) => {
        if (part.type !== "text") {
            return false;
        }
        const textPart = part as typeof part & { text?: string };
        return typeof textPart.text === "string" && textPart.text.includes(ACTUAL_USER_MESSAGE_MARKER);
    });

    if (!hasMarker) {
        return messages;
    }

    let markerFound = false;
    return messages.map((message) => {
        if (message.info.id !== firstUserMessageId) {
            return message;
        }

        const parts = message.parts.map((part) => {
            if (part.type !== "text") {
                return part;
            }
            const textPart = part as typeof part & { text?: string };
            if (typeof textPart.text !== "string") {
                return part;
            }

            if (markerFound) {
                return part;
            }

            const markerIndex = textPart.text.indexOf(ACTUAL_USER_MESSAGE_MARKER);
            if (markerIndex === -1) {
                return {
                    ...textPart,
                    text: ""
                };
            }

            markerFound = true;
            return {
                ...textPart,
                text: stripTextBeforeActualUserMarker(textPart.text)
            };
        });

        return {
            info: message.info,
            parts
        };
    });
}

function sanitizeEventForClient(event: Record<string, unknown>): Record<string, unknown> {
    if (event.type !== "message.part.updated") {
        return event;
    }

    const properties = event.properties;
    if (!properties || typeof properties !== "object") {
        return event;
    }

    const part = (properties as { part?: unknown }).part;
    if (!part || typeof part !== "object") {
        return event;
    }

    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type !== "text" || typeof candidate.text !== "string") {
        return event;
    }

    return {
        ...event,
        properties: {
            ...(properties as Record<string, unknown>),
            part: {
                ...(part as Record<string, unknown>),
                text: stripTextBeforeActualUserMarker(candidate.text)
            }
        }
    };
}

function shouldAutoGenerateTitle(title: string | null): boolean {
    if (!title) return true;
    const normalized = title.trim().toLowerCase();
    if (!normalized) return true;

    const genericPatterns = [
        /^new chat$/,
        /^new session(?:\s*-\s*.*)?$/,
        /^session(?:\s*-\s*.*)?$/,
        /^chat(?:\s*-\s*.*)?$/
    ];

    return genericPatterns.some((pattern) => pattern.test(normalized));
}

function getEventSessionId(event: Record<string, unknown>): string | null {
    const directSessionId = event.sessionID;
    if (typeof directSessionId === "string" && directSessionId.length > 0) {
        return directSessionId;
    }

    const properties = event.properties;
    if (!properties || typeof properties !== "object") {
        return null;
    }

    const propertyRecord = properties as Record<string, unknown>;
    const candidates = [
        propertyRecord.sessionID,
        (propertyRecord.info as Record<string, unknown> | undefined)?.sessionID,
        (propertyRecord.part as Record<string, unknown> | undefined)?.sessionID,
        (propertyRecord.permission as Record<string, unknown> | undefined)?.sessionID,
        (propertyRecord.message as Record<string, unknown> | undefined)?.sessionID,
        (propertyRecord.error as Record<string, unknown> | undefined)?.sessionID
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
    }

    return null;
}

function generateTitleFromUserMessage(content: string): string {
    const maxChars = 60;
    const maxWords = 9;

    let text = content
        .replace(/\s+/g, " ")
        .replace(/[`*_#>\[\]()]/g, "")
        .trim();

    text = text.split(/[.!?\n]/)[0]?.trim() || text;

    const leadingPhrases = [
        "can you ",
        "could you ",
        "please ",
        "help me ",
        "i want to ",
        "i need to ",
        "let's ",
        "lets "
    ];

    let lowered = text.toLowerCase();
    for (const phrase of leadingPhrases) {
        if (lowered.startsWith(phrase)) {
            text = text.slice(phrase.length).trim();
            lowered = text.toLowerCase();
            break;
        }
    }

    const words = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
    let candidate = words.join(" ").trim();

    if (!candidate) {
        return "New Chat";
    }

    if (candidate.length > maxChars) {
        candidate = candidate.slice(0, maxChars).trim();
        if (!/[.!?]$/.test(candidate)) {
            candidate = `${candidate}...`;
        }
    }

    return candidate;
}

function getLatestAssistantMessageId(messages: unknown): string | null {
    assertCondition(Array.isArray(messages), "Session messages response is not an array");

    const sessionMessages = messages as SessionMessageSummary[];
    let latestMessageId: string | null = null;
    let latestAssistantTimestamp = -1;

    for (const message of sessionMessages) {
        if (message.info.role !== "assistant") {
            continue;
        }

        const assistantTimestamp = message.info.time.completed ?? message.info.time.created;

        if (assistantTimestamp > latestAssistantTimestamp) {
            latestAssistantTimestamp = assistantTimestamp;
            latestMessageId = message.info.id;
        }
    }

    return latestMessageId;
}

async function loadLatestAssistantMessageIdForSession(
    client: Awaited<ReturnType<typeof getOpencodeClient>>,
    opencodeSessionId: string
): Promise<string | null> {
    const result = await client.session.messages({
        path: { id: opencodeSessionId }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || "Failed to get messages from opencode");
    }

    return getLatestAssistantMessageId(result.data);
}

function getSessionState(args: {
    rawSessionStatus: SessionStatusType;
    hasPendingInput: boolean;
    latestAssistantMessageId: string | null;
    lastSeenAssistantMessageId: string | null;
}): { state: "idle" | "processing" | "attention"; latest_message_id: string | null } {
    if (args.hasPendingInput) {
        assertCondition(
            args.latestAssistantMessageId !== null,
            "Pending-input session is missing a latest assistant message ID"
        );

        if (args.latestAssistantMessageId === args.lastSeenAssistantMessageId) {
            return {
                state: "idle",
                latest_message_id: args.latestAssistantMessageId
            };
        }

        return {
            state: "attention",
            latest_message_id: args.latestAssistantMessageId
        };
    }

    if (args.rawSessionStatus !== "idle") {
        return {
            state: "processing",
            latest_message_id: args.latestAssistantMessageId
        };
    }

    if (
        args.latestAssistantMessageId !== null
        && args.latestAssistantMessageId !== args.lastSeenAssistantMessageId
    ) {
        return {
            state: "attention",
            latest_message_id: args.latestAssistantMessageId
        };
    }

    return {
        state: "idle",
        latest_message_id: args.latestAssistantMessageId
    };
}

// GET /api/chat/sessions - List user's sessions
router.get('/sessions', apiHandler(async (req, res) => {
    const sessions = await prisma.chat_sessions.findMany({
        where: {
            user_id: req.userId!,
            visible_to_user: true,
        },
        orderBy: { updated_at: 'desc' }
    });

    if (sessions.length === 0) {
        res.json({ sessions });
        return;
    }

    const client = await getOpencodeClient();
    const opencodeSessionsResult = await client.session.list();

    if (opencodeSessionsResult.error) {
        throw new Error(getErrorMessage(opencodeSessionsResult.error) || 'Failed to list sessions from opencode');
    }

    const opencodeSessionIds = new Set((opencodeSessionsResult.data || []).map((session: any) => session.id));
    const staleSessionIds = sessions
        .filter((session) => !opencodeSessionIds.has(session.opencode_session_id))
        .map((session) => session.id);

    if (staleSessionIds.length > 0) {
        await prisma.chat_sessions.deleteMany({
            where: {
                id: { in: staleSessionIds },
                user_id: req.userId!,
            }
        });
    }

    const validSessions = sessions.filter((session) => opencodeSessionIds.has(session.opencode_session_id));
    const statusResult = await client.session.status();
    assertCondition(!statusResult.error, getErrorMessage(statusResult.error));
    const sessionStatusMap = statusResult.data as SessionStatusMap;
    const pendingQuestions = await listPendingQuestions();
    const pendingPermissions = await listPendingPermissions();
    const customPendingPermissions = await prisma.tool_execution_permissions.findMany({
        where: {
            opencode_session_id: {
                in: validSessions.map((session) => session.opencode_session_id)
            },
            status: 'pending'
        },
        select: {
            id: true,
            message_id: true,
            opencode_session_id: true
        }
    });

    const enrichedSessions = await Promise.all(validSessions.map(async (session) => {
        const latestAssistantMessageId = await loadLatestAssistantMessageIdForSession(
            client,
            session.opencode_session_id
        );
        const hasPendingInput = sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId: session.opencode_session_id,
            latestAssistantMessageId,
            pendingQuestions,
            pendingPermissions,
            customPendingPermissions
        });
        const rawSessionStatus = getSessionStatusTypeForSession(sessionStatusMap, session.opencode_session_id);
        const sessionState = getSessionState({
            rawSessionStatus,
            hasPendingInput,
            latestAssistantMessageId,
            lastSeenAssistantMessageId: session.last_seen_assistant_message_id
        });

        return {
            id: session.id,
            opencode_session_id: session.opencode_session_id,
            title: session.title,
            created_at: session.created_at,
            updated_at: session.updated_at,
            state: sessionState.state,
            latest_message_id: sessionState.latest_message_id
        };
    }));

    res.json({ sessions: enrichedSessions });
}, true));

// GET /api/chat/file-suggestions - Search workspace files/folders for @mentions
router.get('/file-suggestions', apiHandler(async (req, res) => {
    const query = req.query.query;
    if (typeof query !== "string") {
        throw {
            status: 400,
            message: "query is required and must be a string"
        };
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        res.json({ files: [] });
        return;
    }

    const rawLimit = req.query.limit;
    let limit = 10;
    if (rawLimit !== undefined) {
        const parsedLimit = Number.parseInt(String(rawLimit), 10);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
            throw {
                status: 400,
                message: "limit must be an integer between 1 and 50"
            };
        }
        limit = parsedLimit;
    }

    const client = await getOpencodeClient();
    const result = await client.find.files({
        query: {
            query: trimmedQuery
        }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || "Failed to fetch file suggestions from opencode");
    }

    res.json({ files: (result.data || []).slice(0, limit) });
}, true));

router.get('/user-instructions', apiHandler(async (req, res) => {
    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only engineers can modify global AI instructions"
        };
    }

    const content = await readWorkspaceUserInstructions();
    res.json({ content: content ?? "" });
}, true));

router.put('/user-instructions', apiHandler(async (req, res) => {
    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only engineers can modify global AI instructions"
        };
    }

    if (typeof req.body?.content !== "string") {
        throw {
            status: 400,
            message: "content is required and must be a string"
        };
    }

    await writeWorkspaceUserInstructions(req.body.content);
    res.json({ content: req.body.content });
}, true));

// POST /api/chat/sessions - Create new session
router.post('/sessions', apiHandler(async (req, res) => {
    const client = await getOpencodeClient();

    // Create session in opencode
    const result = await client.session.create();

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || 'Failed to create opencode session');
    }

    const opencodeSession = result.data!;

    // Save session in our database
    const session = await prisma.chat_sessions.create({
        data: {
            user_id: req.userId!,
            opencode_session_id: opencodeSession.id,
            title: opencodeSession.title || 'New Chat',
            created_at: Date.now(),
            updated_at: Date.now()
        }
    });

    res.json({
        session: {
            id: session.id,
            opencode_session_id: session.opencode_session_id,
            title: session.title,
            created_at: session.created_at,
            updated_at: session.updated_at,
            state: "idle",
            latest_message_id: null
        }
    });
}, true));

// GET /api/chat/sessions/:id - Get session details
router.get('/sessions/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    // Get session details from opencode
    const client = await getOpencodeClient();
    const result = await client.session.get({
        path: { id: session.opencode_session_id }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || 'Failed to get session from opencode');
    }

    res.json({
        session: {
            id: session.id,
            opencode_session_id: session.opencode_session_id,
            title: session.title || result.data?.title,
            created_at: session.created_at,
            updated_at: session.updated_at,
            opencode_data: result.data
        }
    });
}, true));

// POST /api/chat/sessions/file-diff/capture-baseline - Capture pre-apply_patch baseline for current opencode session
router.post('/sessions/file-diff/capture-baseline', apiHandler(async (req, res) => {
    if (!req.opencode_session_id) {
        throw {
            status: 403,
            message: 'This endpoint requires an opencode session token'
        };
    }

    const rawPath = req.body?.path;
    if (typeof rawPath !== 'string') {
        throw {
            status: 400,
            message: 'path is required and must be a string'
        };
    }

    const relativePath = normalizeWorkspaceRelativePath(rawPath);
    const session = await prisma.chat_sessions.findFirst({
        where: {
            opencode_session_id: req.opencode_session_id,
            user_id: req.userId!,
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const existing = await prisma.chat_session_tracked_files.findUnique({
        where: {
            chat_session_id_relative_path: {
                chat_session_id: session.id,
                relative_path: relativePath,
            }
        }
    });

    if (!existing) {
        const baseline = captureCurrentFileBaseline(relativePath);
        const now = BigInt(Date.now());
        await prisma.chat_session_tracked_files.create({
            data: {
                chat_session_id: session.id,
                relative_path: relativePath,
                existed_at_baseline: baseline.existed_at_baseline,
                content_kind: baseline.content_kind,
                text_content: baseline.text_content,
                binary_content: baseline.binary_content ? new Uint8Array(baseline.binary_content) : null,
                size_bytes: baseline.size_bytes,
                content_sha256: baseline.content_sha256,
                created_at: now,
                updated_at: now,
            }
        });
    }

    res.json({ success: true });
}, true));

// GET /api/chat/sessions/:id/file-diff - Get tracked file diffs for a chat session
router.get('/sessions/:id/file-diff', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!,
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const trackedFiles = await prisma.chat_session_tracked_files.findMany({
        where: {
            chat_session_id: session.id,
        },
        orderBy: {
            relative_path: 'asc'
        }
    });

    const diff = buildChatSessionFileDiffResponse(trackedFiles.map((trackedFile) => ({
        relative_path: trackedFile.relative_path,
        existed_at_baseline: trackedFile.existed_at_baseline,
        content_kind: trackedFile.content_kind as "text" | "binary" | "missing",
        text_content: trackedFile.text_content,
        binary_content: trackedFile.binary_content ? new Uint8Array(trackedFile.binary_content) : null,
        size_bytes: trackedFile.size_bytes,
        content_sha256: trackedFile.content_sha256,
    })));

    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json(diff);
}, true));

/*
// DELETE /api/chat/sessions/:id - Delete session
router.delete('/sessions/:id', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    // Delete session from opencode
    const client = await getOpencodeClient();
    await client.session.delete({
        path: { id: session.opencode_session_id }
    });

    // Delete from our database
    await prisma.chat_sessions.delete({
        where: { id }
    });

    res.json({ success: true });
}, true));
*/

// GET /api/chat/sessions/:id/messages - Get messages
router.get('/sessions/:id/messages', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const client = await getOpencodeClient();
    const result = await client.session.messages({
        path: { id: session.opencode_session_id }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || 'Failed to get messages from opencode');
    }

    const statusResult = await client.session.status();
    assertCondition(!statusResult.error, getErrorMessage(statusResult.error));
    const sessionStatusType: SessionStatusType = getSessionStatusTypeForSession(
        statusResult.data as SessionStatusMap,
        session.opencode_session_id
    );
    const normalizedMessages = normalizeStaleRunningTools(result.data as SessionMessageWire[], sessionStatusType);
    const sanitizedMessages = sanitizeFirstUserMessageForClient(normalizedMessages);

    res.json({
        messages: sanitizedMessages,
        session_status: sessionStatusType
    });
}, true));

router.post('/sessions/:id/sync-usage', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    await syncChatSessionUsage(session.id, session.opencode_session_id);
    res.json({ success: true });
}, true));

// POST /api/chat/sessions/:id/messages - Send message
router.post('/sessions/:id/messages', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const rawParts = req.body?.parts;

    if (rawParts === undefined) {
        throw {
            status: 400,
            message: "parts is required"
        };
    }
    const inputParts = parseMessageParts(rawParts);

    if (inputParts.length === 0) {
        throw {
            status: 400,
            message: "parts must contain at least one item"
        };
    }

    if (!inputParts.some((part) => part.type === "text" && part.text.trim().length > 0)) {
        throw {
            status: 400,
            message: "Message must include a non-empty text part"
        };
    }

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const pendingQuestion = await getPendingQuestionForSession(session.opencode_session_id);
    if (pendingQuestion) {
        throw {
            status: 409,
            message: 'A tool is waiting for input. Reply through the tool-answer endpoint.'
        };
    }
    const pendingPermission = await listPendingPermissionsForSession(session.opencode_session_id);
    if (pendingPermission.length > 0) {
        throw {
            status: 409,
            message: 'At least one permission request is waiting for input. Reply through the permission-response endpoint.'
        };
    }

    const client = await getOpencodeClient();
    const promptParts = buildOpencodePromptParts(inputParts);
    let finalPromptParts = promptParts;

    const existingMessagesResult = await client.session.messages({
        path: { id: session.opencode_session_id },
        query: { limit: 1 }
    });
    if (existingMessagesResult.error) {
        throw new Error(getErrorMessage(existingMessagesResult.error) || "Failed to check session message history");
    }

    if ((existingMessagesResult.data || []).length === 0) {
        const userInstructions = await readWorkspaceUserInstructions();
        const availableSkillsPrompt = await buildAvailableSkillsPrompt(req.userId!);
        const availableSecretsPrompt = await buildAvailableSecretsPrompt(req.userId!);
        if (userInstructions || availableSkillsPrompt || availableSecretsPrompt) {
            const preambleSections: string[] = [];
            if (userInstructions) {
                preambleSections.push(`# Custom user instructions (in case of conflicts, the instructions here take precedence over the contents of the AGENTS.md file)\n\n${userInstructions}`);
            }
            if (availableSkillsPrompt) {
                preambleSections.push(availableSkillsPrompt);
            }
            if (availableSecretsPrompt) {
                preambleSections.push(availableSecretsPrompt);
            }

            const wrappedUserInstructions = `${preambleSections.join("\n\n")}\n\n${ACTUAL_USER_MESSAGE_MARKER}\n\n`;
            finalPromptParts = [
                {
                    type: "text",
                    text: wrappedUserInstructions
                },
                ...promptParts
            ];
        }
    }

    // Use promptAsync to send message and return immediately
    const result = await client.session.promptAsync({
        path: { id: session.opencode_session_id },
        body: { parts: finalPromptParts }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || 'Failed to send message to opencode');
    }

    const data: { updated_at: number; title?: string } = {
        updated_at: Date.now()
    };

    if (shouldAutoGenerateTitle(session.title)) {
        const firstTextPart = inputParts.find((part): part is ChatTextPartInput => part.type === "text" && part.text.trim().length > 0);
        data.title = generateTitleFromUserMessage(firstTextPart?.text || "");
    }

    const updatedSession = await prisma.chat_sessions.update({
        where: { id },
        data
    });

    res.json({
        success: true,
        session: {
            id: updatedSession.id,
            title: updatedSession.title,
            updated_at: updatedSession.updated_at
        }
    });
}, true));

// GET /api/chat/sessions/:id/pending-permission - Get pending permission for session
router.get('/sessions/:id/pending-permission', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const permissions: Array<{
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
    }> = [];
    // Include opencode native pending permissions
    const opencodePendingPermissions = (await listPendingPermissions())
        .filter((permission) =>
            permission.sessionID === session.opencode_session_id
        )
        .map((permission) => {
            assertCondition(
                typeof permission.tool?.messageID === 'string' && typeof permission.tool?.callID === 'string',
                `Pending opencode permission '${permission.id}' is missing tool.messageID/callID`
            );
            return {
                ...permission,
                tool: {
                    messageID: permission.tool.messageID,
                    callID: permission.tool.callID
                }
            };
        });
    permissions.push(...opencodePendingPermissions);

    // Include custom tool execution pending permissions
    const customPendingPermissions = await prisma.tool_execution_permissions.findMany({
        where: {
            opencode_session_id: session.opencode_session_id,
            status: 'pending'
        },
        orderBy: {
            created_at: 'asc'
        }
    });

    for (const customPendingPermission of customPendingPermissions) {
        permissions.push({
            id: customPendingPermission.id,
            sessionID: customPendingPermission.opencode_session_id,
            permission: 'tool',
            patterns: [],
            metadata: {},
            always: [],
            tool: {
                messageID: customPendingPermission.message_id,
                callID: customPendingPermission.call_id
            }
        });
    }

    res.json({ permissions });
}, true));

// POST /api/chat/sessions/:id/tool-answer - Reply to a pending tool question
router.post('/sessions/:id/tool-answer', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
        throw {
            status: 400,
            message: 'content is required and must be a string'
        };
    }

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const pendingQuestion = await getPendingQuestionForSession(session.opencode_session_id);
    if (!pendingQuestion) {
        throw {
            status: 409,
            message: 'No pending tool question for this session'
        };
    }

    // Current UI replies with a single string; map it to the first question.
    const answers = pendingQuestion.questions.map((_, index) => index === 0 ? [content] : []);
    await replyToPendingQuestion(pendingQuestion.id, answers);

    await prisma.chat_sessions.update({
        where: { id },
        data: { updated_at: Date.now() }
    });

    res.json({ success: true });
}, true));

// POST /api/chat/sessions/:id/read - Mark the latest assistant output as seen
router.post('/sessions/:id/read', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const client = await getOpencodeClient();
    const lastSeenAssistantMessageId = await loadLatestAssistantMessageIdForSession(
        client,
        session.opencode_session_id
    );

    await prisma.chat_sessions.update({
        where: { id },
        data: {
            last_seen_assistant_message_id: lastSeenAssistantMessageId
        }
    });

    res.json({ success: true });
}, true));

// POST /api/chat/sessions/:id/permission-response - Reply to a pending permission request
router.post('/sessions/:id/permission-response', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const { response, permission_id } = req.body as { response: unknown; permission_id: unknown };

    if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw {
            status: 400,
            message: 'response is required and must be one of: once, always, reject'
        };
    }
    if (typeof permission_id !== 'string') {
        throw {
            status: 400,
            message: 'permission_id is required and must be a string'
        };
    }

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    // First check our custom tool execution permissions by explicit permission_id.
    const customPendingPermission = await prisma.tool_execution_permissions.findFirst({
        where: {
            id: permission_id,
            opencode_session_id: session.opencode_session_id,
            status: 'pending'
        }
    });

    if (customPendingPermission) {
        // Update our custom permission status
        await prisma.tool_execution_permissions.update({
            where: { id: customPendingPermission.id },
            data: {
                status: response === 'reject' ? 'rejected' : 'approved',
                responded_at: BigInt(Date.now())
            }
        });

        await prisma.chat_sessions.update({
            where: { id },
            data: { updated_at: Date.now() }
        });

        res.json({ success: true });
        return;
    }

    // Otherwise treat it as an opencode-native permission ID and reply directly.
    await replyToPendingPermission(session.opencode_session_id, permission_id, response);

    await prisma.chat_sessions.update({
        where: { id },
        data: { updated_at: Date.now() }
    });

    res.json({ success: true });
}, true));

// POST /api/chat/sessions/:id/abort - Abort AI response
router.post('/sessions/:id/abort', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const runningCronRun = await prisma.cronjob_runs.findFirst({
        where: {
            session_id: id,
            status: "running",
        },
        select: {
            id: true,
            status: true,
            opencode_session_id: true,
            workflow_run_id: true,
        },
    });
    if (runningCronRun) {
        await stopCronjobRun(runningCronRun);
    } else {
        await abortOpencodeSession(session.opencode_session_id);
    }

    res.json({
        success: true
    });
}, true));

// GET /api/chat/sessions/:id/events - SSE stream for real-time updates
router.get('/sessions/:id/events', apiHandler(async (req, res) => {
    const id = req.params.id as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            id,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const port = getOpencodePort();
    const workspaceDir = getWorkspaceDir();

    // Create an abort controller for cleanup
    const abortController = new AbortController();

    // Handle client disconnect
    req.on('close', () => {
        abortController.abort();
    });

    try {
        // Subscribe to opencode events using fetch with SSE
        const response = await fetch(`http://localhost:${port}/event?directory=${encodeURIComponent(workspaceDir)}`, {
            headers: {
                'Accept': 'text/event-stream',
            },
            signal: abortController.signal
        });

        if (!response.ok || !response.body) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to connect to opencode events' })}\n\n`);
            res.end();
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const data = line.slice(5).trim();
                    if (data) {
                        try {
                            const event = JSON.parse(data);
                            const eventSessionId = getEventSessionId(event as Record<string, unknown>);

                            // Filter events to only include ones for this session
                            if (eventSessionId === session.opencode_session_id) {
                                const sanitizedEvent = sanitizeEventForClient(event as Record<string, unknown>);
                                res.write(`data: ${JSON.stringify(sanitizeForClient(sanitizedEvent))}\n\n`);
                            }
                        } catch {
                            // Skip malformed JSON
                        }
                    }
                }
            }
        }
    } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'SSE stream error' })}\n\n`);
        }
    }

    res.end();
}, true));

export default router;

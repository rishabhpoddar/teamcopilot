import express from "express";
import fs from "fs/promises";
import path from "path";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";
import {
    getOpencodeClient,
    getPendingQuestionForSession,
    getPendingPermissionForSession,
    getWorkspaceDir,
    getOpencodePort,
    replyToPendingQuestion,
    replyToPendingPermission
} from "../utils/opencode-client";
import {
    getSessionStatusTypeForSession,
    normalizeStaleRunningTools,
    type SessionMessageWire,
    type SessionStatusMap,
    type SessionStatusType
} from "../utils/chat-session";
import { assertCondition } from "../utils/assert";
import { sanitizeForClient } from "../utils/redact";
import { abortOpencodeSession } from "../utils/session-abort";

const router = express.Router({ mergeParams: true });

function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'detail' in error) {
        return String((error as { detail: unknown }).detail);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unknown error';
}

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isPathInside(childPath: string, parentPath: string): boolean {
    const parent = path.resolve(parentPath) + path.sep;
    const child = path.resolve(childPath) + path.sep;
    return child.startsWith(parent);
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

// GET /api/chat/sessions - List user's sessions
router.get('/sessions', apiHandler(async (req, res) => {
    const sessions = await prisma.chat_sessions.findMany({
        where: { user_id: req.userId! },
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
                user_id: req.userId!
            }
        });
    }

    const validSessions = sessions.filter((session) => opencodeSessionIds.has(session.opencode_session_id));
    res.json({ sessions: validSessions });
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
            updated_at: session.updated_at
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

    res.json({
        messages: normalizedMessages,
        session_status: sessionStatusType
    });
}, true));

// GET /api/chat/workflow-runs/:sessionId/:messageId/logs - Get runWorkflow log file
router.get('/workflow-runs/:sessionId/:messageId/logs', apiHandler(async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const messageId = req.params.messageId as string;

    const session = await prisma.chat_sessions.findFirst({
        where: {
            opencode_session_id: sessionId,
            user_id: req.userId!
        }
    });

    if (!session) {
        throw {
            status: 404,
            message: 'Session not found'
        };
    }

    const workspaceDir = getWorkspaceDir();
    const workflowRunsDir = path.join(workspaceDir, 'workflow-runs');
    const filename = `${sanitizeFilenamePart(sessionId)}-${sanitizeFilenamePart(messageId)}.txt`;
    const logPath = path.join(workflowRunsDir, filename);

    if (!isPathInside(logPath, workflowRunsDir)) {
        throw {
            status: 400,
            message: 'Invalid log path'
        };
    }

    try {
        const logs = await fs.readFile(logPath, 'utf-8');
        res.json({
            found: true,
            logs
        });
    } catch {
        res.json({
            found: false,
            logs: null
        });
    }
}, true));

// POST /api/chat/sessions/:id/messages - Send message
router.post('/sessions/:id/messages', apiHandler(async (req, res) => {
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
    if (pendingQuestion) {
        throw {
            status: 409,
            message: 'A tool is waiting for input. Reply through the tool-answer endpoint.'
        };
    }
    const pendingPermission = await getPendingPermissionForSession(session.opencode_session_id);
    if (pendingPermission) {
        throw {
            status: 409,
            message: 'A permission request is waiting for input. Reply through the permission-response endpoint.'
        };
    }

    const client = await getOpencodeClient();

    // Use promptAsync to send message and return immediately
    const result = await client.session.promptAsync({
        path: { id: session.opencode_session_id },
        body: { parts: [{ type: "text", text: content }] }
    });

    if (result.error) {
        throw new Error(getErrorMessage(result.error) || 'Failed to send message to opencode');
    }

    const data: { updated_at: number; title?: string } = {
        updated_at: Date.now()
    };

    if (shouldAutoGenerateTitle(session.title)) {
        data.title = generateTitleFromUserMessage(content);
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

    // First check for opencode's native permissions
    const opencodePendingPermission = await getPendingPermissionForSession(session.opencode_session_id);
    if (opencodePendingPermission) {
        res.json({ permission: opencodePendingPermission });
        return;
    }

    // Then check for our custom tool execution permissions
    const customPendingPermission = await prisma.tool_execution_permissions.findFirst({
        where: {
            opencode_session_id: session.opencode_session_id,
            status: 'pending'
        },
        orderBy: {
            created_at: 'desc'
        }
    });

    if (customPendingPermission) {
        // Fetch messages to get tool call details
        const client = await getOpencodeClient();
        const messagesResult = await client.session.messages({
            path: { id: session.opencode_session_id }
        });

        if (messagesResult.error || !messagesResult.data) {
            // Can't fetch messages, permission is stale - mark as rejected
            await prisma.tool_execution_permissions.update({
                where: { id: customPendingPermission.id },
                data: { status: 'rejected', responded_at: BigInt(Date.now()) }
            });
            res.json({ permission: null });
            return;
        }

        // Find the tool part across all messages
        let toolPart: { type: string; tool?: string; args?: Record<string, unknown> } | undefined;
        for (const message of messagesResult.data as { parts: { type: string; messageID: string; callID: string; tool?: string; args?: Record<string, unknown> }[] }[]) {
            toolPart = message.parts.find(p =>
                p.type === 'tool' &&
                p.messageID === customPendingPermission.message_id &&
                p.callID === customPendingPermission.call_id
            );
            if (toolPart) break;
        }

        if (!toolPart) {
            // Tool part not found, permission is stale - mark as rejected
            await prisma.tool_execution_permissions.update({
                where: { id: customPendingPermission.id },
                data: { status: 'rejected', responded_at: BigInt(Date.now()) }
            });
            res.json({ permission: null });
            return;
        }

        const toolName = toolPart.tool || 'unknown';
        const toolArgs = toolPart.args || {};

        // Format to match opencode's permission structure for transparent UI reuse
        res.json({
            permission: {
                id: customPendingPermission.id,
                sessionID: customPendingPermission.opencode_session_id,
                permission: toolName,
                patterns: [JSON.stringify(toolArgs)],
                metadata: toolArgs,
                always: [],
                tool: {
                    messageID: customPendingPermission.message_id,
                    callID: customPendingPermission.call_id
                }
            }
        });
        return;
    }

    res.json({ permission: null });
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

// POST /api/chat/sessions/:id/permission-response - Reply to a pending permission request
router.post('/sessions/:id/permission-response', apiHandler(async (req, res) => {
    const id = req.params.id as string;
    const { response } = req.body as { response: unknown };

    if (response !== 'once' && response !== 'always' && response !== 'reject') {
        throw {
            status: 400,
            message: 'response is required and must be one of: once, always, reject'
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

    // First check for opencode's native permissions
    const opencodePendingPermission = await getPendingPermissionForSession(session.opencode_session_id);
    if (opencodePendingPermission) {
        await replyToPendingPermission(session.opencode_session_id, opencodePendingPermission.id, response);
        await prisma.chat_sessions.update({
            where: { id },
            data: { updated_at: Date.now() }
        });
        res.json({ success: true });
        return;
    }

    // Then check for our custom tool execution permissions
    const customPendingPermission = await prisma.tool_execution_permissions.findFirst({
        where: {
            opencode_session_id: session.opencode_session_id,
            status: 'pending'
        },
        orderBy: {
            created_at: 'desc'
        }
    });

    if (!customPendingPermission) {
        throw {
            status: 409,
            message: 'No pending permission request for this session'
        };
    }

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

    await abortOpencodeSession(session.opencode_session_id);

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
                            // Check all possible locations for sessionID
                            const eventSessionId = event.properties?.sessionID ||
                                event.sessionID ||
                                event.properties?.info?.sessionID ||
                                event.properties?.part?.sessionID ||
                                event.properties?.permission?.sessionID;

                            // Filter events to only include ones for this session
                            if (eventSessionId === session.opencode_session_id) {
                                res.write(`data: ${JSON.stringify(sanitizeForClient(event))}\n\n`);
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

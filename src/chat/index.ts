import express from "express";
import path from "path";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";
import { getOpencodeClient, getPendingQuestionForSession, getWorkspaceDir, getOpencodePort, replyToPendingQuestion } from "../utils/opencode-client";

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
        throw {
            status: 500,
            message: getErrorMessage(opencodeSessionsResult.error) || 'Failed to list sessions from opencode'
        };
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
        throw {
            status: 500,
            message: getErrorMessage(result.error) || 'Failed to create opencode session'
        };
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
        throw {
            status: 500,
            message: getErrorMessage(result.error) || 'Failed to get session from opencode'
        };
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
        throw {
            status: 500,
            message: getErrorMessage(result.error) || 'Failed to get messages from opencode'
        };
    }

    res.json({ messages: result.data });
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

    const client = await getOpencodeClient();

    // Use promptAsync to send message and return immediately
    const result = await client.session.promptAsync({
        path: { id: session.opencode_session_id },
        body: { parts: [{ type: "text", text: content }] }
    });

    if (result.error) {
        throw {
            status: 500,
            message: getErrorMessage(result.error) || 'Failed to send message to opencode'
        };
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
    try {
        await replyToPendingQuestion(pendingQuestion.id, answers);
    } catch (err: unknown) {
        throw {
            status: 500,
            message: getErrorMessage(err) || 'Failed to reply to pending question'
        };
    }

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

    const client = await getOpencodeClient();
    const result = await client.session.abort({
        path: { id: session.opencode_session_id }
    });

    if (result.error) {
        throw {
            status: 500,
            message: getErrorMessage(result.error) || 'Failed to abort session'
        };
    }

    res.json({ success: true });
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
                                event.properties?.info?.sessionID ||
                                event.properties?.part?.sessionID;

                            // Filter events to only include ones for this session
                            if (eventSessionId === session.opencode_session_id) {
                                res.write(`data: ${JSON.stringify(event)}\n\n`);
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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import { AxiosError } from 'axios';
import { axiosInstance, assertMessagesPayload, assertSessionStatus } from '../../../utils';
import { useAuth } from '../../../lib/auth';
import type {
    ChatSession,
    Message,
    Part,
    SSEEvent,
    ToolPart,
    PermissionRequest
} from '../../../types/chat';
import SessionSidebar from './SessionSidebar';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import './Chat.css';

interface ChatContainerProps {
    initialDraftMessage: string | null;
    forceNewChat: boolean;
    onDraftHandled: () => void;
}

export default function ChatContainer({ initialDraftMessage, forceNewChat, onDraftHandled }: ChatContainerProps) {
    const PENDING_SESSION_ID = 'pending';
    const auth = useAuth();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [parts, setParts] = useState<Part[]>([]);
    const [loading, setLoading] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draftMessagesBySessionId, setDraftMessagesBySessionId] = useState<Record<string, string>>({});
    const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
    const [isRespondingToPermission, setIsRespondingToPermission] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const lastEscapePressRef = useRef<number>(0);
    const currentSessionInfoRef = useRef<{ id: string; isEmpty: boolean } | null>(null);
    const handledComposeKeyRef = useRef<string | null>(null);

    const token = auth.loading ? null : auth.token;

    // Detect if there's a question tool waiting for user input
    const isWaitingForInput = useMemo(() => {
        const toolParts = parts.filter((p): p is ToolPart => p.type === 'tool');
        return toolParts.some(part =>
            part.tool === 'question' &&
            (part.state.status === 'running' || part.state.status === 'pending')
        );
    }, [parts]);

    const stopSSE = useCallback(() => {
        if (readerRef.current) {
            readerRef.current.cancel();
            readerRef.current = null;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, []);

    const handleSSEEvent = useCallback((event: SSEEvent) => {
        switch (event.type) {
            case 'message.updated': {
                const { info } = event.properties;
                setMessages(prev => {
                    const exists = prev.find(m => m.id === info.id);
                    if (exists) {
                        return prev.map(m => m.id === info.id ? info : m);
                    }
                    // When a new user message arrives, remove any temp messages
                    // This handles the optimistic update replacement
                    if (info.role === 'user') {
                        const filtered = prev.filter(m => !m.id.startsWith('temp-'));
                        return [...filtered, info];
                    }
                    return [...prev, info];
                });

                // Track streaming state based on assistant messages
                if (info.role === 'assistant') {
                    if (info.time.completed) {
                        setIsStreaming(false);
                    } else {
                        setIsStreaming(true);
                    }
                }
                break;
            }

            case 'message.removed': {
                const { messageID } = event.properties;
                setMessages(prev => prev.filter(m => m.id !== messageID));
                setParts(prev => prev.filter(p => p.messageID !== messageID));
                break;
            }

            case 'message.part.updated': {
                const { part } = event.properties;
                setParts(prev => {
                    const exists = prev.find(p => p.id === part.id);
                    if (exists) {
                        return prev.map(p => p.id === part.id ? part : p);
                    }
                    // Remove temp parts when real parts arrive (handles optimistic updates)
                    const filtered = prev.filter(p => !p.id.startsWith('temp-'));
                    return [...filtered, part];
                });
                break;
            }

            case 'message.part.removed': {
                const { partID } = event.properties;
                setParts(prev => prev.filter(p => p.id !== partID));
                break;
            }

            case 'error': {
                toast.error(event.message);
                setIsStreaming(false);
                break;
            }

            case 'session.error': {
                setIsStreaming(false);
                break;
            }

            case 'session.status': {
                const status = event.properties.status;
                if (status.type === 'idle') {
                    setIsStreaming(false);
                } else if (status.type === 'busy' || status.type === 'retry') {
                    setIsStreaming(true);
                }
                break;
            }

            case 'session.idle': {
                setIsStreaming(false);
                break;
            }

            case 'permission.asked': {
                setPendingPermission((prev) => prev?.id === event.properties.id ? prev : event.properties);
                break;
            }

            case 'permission.replied': {
                setPendingPermission((prev) => {
                    if (!prev) return prev;
                    if (event.properties.sessionID !== prev.sessionID) return prev;
                    if (event.properties.requestID !== prev.id) return prev;
                    return null;
                });
                break;
            }
        }
    }, []);

    const startSSE = useCallback((sessionId: string) => {
        if (!token) return;

        // Stop any existing connection
        stopSSE();

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const connectSSE = async () => {
            try {
                const response = await fetch(`/api/chat/sessions/${sessionId}/events`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'text/event-stream'
                    },
                    signal: controller.signal
                });

                if (!response.ok || !response.body) {
                    console.error('Failed to connect to SSE');
                    return;
                }

                const reader = response.body.getReader();
                readerRef.current = reader;
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const data = line.slice(5).trim();
                            if (data) {
                                try {
                                    const event: SSEEvent = JSON.parse(data);
                                    handleSSEEvent(event);
                                } catch {
                                    // Skip malformed JSON
                                }
                            }
                        }
                    }
                }
            } catch (err: unknown) {
                // Ignore abort errors (expected when disconnecting)
                if ((err as Error).name === 'AbortError') return;
            }
        };

        connectSSE();
    }, [token, stopSSE, handleSSEEvent]);

    const loadSessions = useCallback(async () => {
        if (!token) return;

        try {
            setLoading(true);
            const response = await axiosInstance.get('/api/chat/sessions', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSessions(response.data.sessions);
            setError(null);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load sessions';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const loadMessages = useCallback(async (sessionId: string) => {
        if (!token) return;

        try {
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/messages`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const data = assertMessagesPayload(response.data.messages);
            const sessionStatus = assertSessionStatus(response.data.session_status);
            // The API returns an array of { info: Message, parts: Part[] } objects
            const loadedMessages: Message[] = [];
            const loadedParts: Part[] = [];

            data.forEach((item) => {
                loadedMessages.push(item.info);
                loadedParts.push(...item.parts);
            });

            setMessages(loadedMessages);
            setParts(loadedParts);
            const isSessionBusy = sessionStatus === 'busy' || sessionStatus === 'retry';
            if (!isSessionBusy) {
                setIsStreaming(false);
            } else {
                const hasActiveAssistantMessage = loadedMessages.some(
                    (message) => message.role === 'assistant' && !message.time.completed
                );
                const hasRunningTool = loadedParts.some(
                    (part) => part.type === 'tool' && (part.state.status === 'running' || part.state.status === 'pending')
                );
                setIsStreaming(hasActiveAssistantMessage || hasRunningTool);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load messages';
            toast.error(errorMessage);
        }
    }, [token]);

    const loadPendingPermission = useCallback(async (sessionId: string) => {
        if (!token) return;

        try {
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/pending-permission`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const permission = (response.data?.permission ?? null) as PermissionRequest | null;
            setPendingPermission((prev) => {
                if (!prev && !permission) return prev;
                if (prev && permission && prev.id === permission.id) return prev;
                return permission;
            });
        } catch {
            // Best-effort background check.
        }
    }, [token]);

    // Load sessions on mount
    useEffect(() => {
        if (!token) return;
        loadSessions();
    }, [token, loadSessions]);

    // Load messages when active session changes
    useEffect(() => {
        // Reset streaming state when switching sessions
        setIsStreaming(false);

        if (activeSessionId && activeSessionId !== PENDING_SESSION_ID) {
            loadMessages(activeSessionId);
            loadPendingPermission(activeSessionId);
            startSSE(activeSessionId);
        } else {
            setMessages([]);
            setParts([]);
            setPendingPermission(null);
        }

        return () => {
            stopSSE();
        };
    }, [activeSessionId, loadMessages, loadPendingPermission, startSSE, stopSSE]);

    const deleteSessionSilently = useCallback(async (sessionId: string) => {
        if (!token) return;
        try {
            await axiosInstance.delete(`/api/chat/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch {
            // Silently fail - this is cleanup
        }
    }, [token]);

    const switchSession = useCallback((newSessionId: string | null) => {
        // Clean up previous empty session
        const prev = currentSessionInfoRef.current;
        if (prev && prev.isEmpty && prev.id !== newSessionId) {
            deleteSessionSilently(prev.id);
        }
        setActiveSessionId(newSessionId);
    }, [deleteSessionSilently]);

    const createSession = () => {
        // If already in pending new chat mode, do nothing
        if (activeSessionId === PENDING_SESSION_ID) {
            return;
        }

        // Switch to pending mode - session will be created when first message is sent
        switchSession(PENDING_SESSION_ID);
    };

    useEffect(() => {
        const composeKey = `${forceNewChat ? '1' : '0'}::${initialDraftMessage ?? ''}`;
        if (composeKey === '0::') {
            return;
        }
        if (handledComposeKeyRef.current === composeKey) {
            return;
        }
        handledComposeKeyRef.current = composeKey;

        const targetSessionId = forceNewChat ? PENDING_SESSION_ID : activeSessionId;
        if (forceNewChat) {
            createSession();
        }
        if (initialDraftMessage && targetSessionId) {
            setDraftMessagesBySessionId(prev => ({
                ...prev,
                [targetSessionId]: initialDraftMessage
            }));
        }
        onDraftHandled();
    }, [forceNewChat, initialDraftMessage, activeSessionId, onDraftHandled]);

    const deleteSession = async (sessionId: string) => {
        if (!token) return;

        try {
            await axiosInstance.delete(`/api/chat/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setSessions(prev => prev.filter(s => s.id !== sessionId));
            setDraftMessagesBySessionId(prev => {
                const next = { ...prev };
                delete next[sessionId];
                return next;
            });
            if (activeSessionId === sessionId) {
                currentSessionInfoRef.current = null;
                setActiveSessionId(null);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to delete session';
            toast.error(errorMessage);
        }
    };

    // Track whether current session is empty (skip for pending)
    useEffect(() => {
        if (activeSessionId && activeSessionId !== PENDING_SESSION_ID) {
            currentSessionInfoRef.current = {
                id: activeSessionId,
                isEmpty: messages.length === 0
            };
        } else {
            currentSessionInfoRef.current = null;
        }
    }, [activeSessionId, messages.length]);

    const sendMessage = async (content: string) => {
        if (!token || !activeSessionId) return;

        const isPending = activeSessionId === PENDING_SESSION_ID;
        let tempUserMessage: Message | null = null;
        let tempTextPart: Part | null = null;

        // Optimistically add user message to UI
        tempUserMessage = {
            id: `temp-${Date.now()}`,
            sessionID: 'temp',
            role: 'user',
            time: { created: Date.now() }
        };
        tempTextPart = {
            id: `temp-part-${Date.now()}`,
            sessionID: 'temp',
            messageID: tempUserMessage.id,
            type: 'text',
            text: content
        };
        setMessages(prev => [...prev, tempUserMessage!]);
        setParts(prev => [...prev, tempTextPart!]);

        try {
            setIsStreaming(true);

            let sessionId = activeSessionId;

            // If pending, create the session first
            if (isPending) {
                const createResponse = await axiosInstance.post('/api/chat/sessions', {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const newSession = createResponse.data.session;
                setSessions(prev => [newSession, ...prev]);
                setActiveSessionId(newSession.id);
                setDraftMessagesBySessionId(prev => {
                    const next = { ...prev };
                    delete next[PENDING_SESSION_ID];
                    return next;
                });
                sessionId = newSession.id;
                // Start SSE for the new session
                startSSE(newSession.id);
            }

            // Send the message
            const sendResponse = await axiosInstance.post(
                `/api/chat/sessions/${sessionId}/messages`,
                { content },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const updatedSession = sendResponse.data?.session as { id: string; title: string | null; updated_at: number } | undefined;
            if (updatedSession) {
                setSessions(prev =>
                    prev
                        .map(s => s.id === updatedSession.id
                            ? { ...s, title: updatedSession.title, updated_at: updatedSession.updated_at }
                            : s
                        )
                        .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
                );
            }
            // The real message will appear through SSE events and replace our temp one
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to send message';
            toast.error(errorMessage);
            setIsStreaming(false);
            // Remove temp message on error
            setMessages(prev => prev.filter(m => m.id !== tempUserMessage!.id));
            setParts(prev => prev.filter(p => p.id !== tempTextPart!.id));
            // If we were pending, go back to pending state
            if (isPending) {
                setActiveSessionId(PENDING_SESSION_ID);
            }
        }
    };

    const sendToolAnswer = async (content: string) => {
        if (!token || !activeSessionId || activeSessionId === PENDING_SESSION_ID) return;

        try {
            setIsStreaming(true);
            await axiosInstance.post(
                `/api/chat/sessions/${activeSessionId}/tool-answer`,
                { content },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            // Tool status and subsequent assistant output arrive via SSE.
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to send tool answer';
            toast.error(errorMessage);
            setIsStreaming(false);
        }
    };

    const abortResponse = useCallback(async () => {
        if (!token || !activeSessionId || activeSessionId === PENDING_SESSION_ID) return;

        try {
            await axiosInstance.post(
                `/api/chat/sessions/${activeSessionId}/abort`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setIsStreaming(false);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to abort response';
            toast.error(errorMessage);
        }
    }, [token, activeSessionId]);

    const sendPermissionResponse = async (response: "once" | "always" | "reject") => {
        if (!token || !activeSessionId || activeSessionId === PENDING_SESSION_ID || !pendingPermission) return;

        try {
            setIsRespondingToPermission(true);
            await axiosInstance.post(
                `/api/chat/sessions/${activeSessionId}/permission-response`,
                { response },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setPendingPermission(null);
            void loadMessages(activeSessionId);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to send permission response';
            toast.error(errorMessage);
        } finally {
            setIsRespondingToPermission(false);
        }
    };

    useEffect(() => {
        if (!activeSessionId || activeSessionId === PENDING_SESSION_ID || !isStreaming || pendingPermission) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadPendingPermission(activeSessionId);
        }, 1000);

        return () => window.clearInterval(intervalId);
    }, [activeSessionId, isStreaming, pendingPermission, loadPendingPermission]);

    const activeDraftMessage = activeSessionId ? (draftMessagesBySessionId[activeSessionId] ?? '') : '';

    // Double-escape to abort
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isStreaming) {
                const now = Date.now();
                if (now - lastEscapePressRef.current < 500) {
                    abortResponse();
                    lastEscapePressRef.current = 0;
                } else {
                    lastEscapePressRef.current = now;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isStreaming, abortResponse]);

    if (auth.loading) return null;

    if (error && sessions.length === 0) {
        return (
            <div className="chat-layout">
                <div className="chat-main">
                    <div className="chat-empty">
                        <h3>Error</h3>
                        <p>{error}</p>
                        <button onClick={loadSessions}>Retry</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="chat-layout">
            <SessionSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={switchSession}
                onNewSession={createSession}
                onDeleteSession={deleteSession}
                loading={loading}
            />
            <div className="chat-main">
                {activeSessionId ? (
                    <>
                        <MessageList
                            messages={messages}
                            parts={parts}
                            isStreaming={isStreaming}
                            isWaitingForInput={isWaitingForInput || Boolean(pendingPermission)}
                            onAnswer={sendToolAnswer}
                            pendingPermission={pendingPermission}
                            onPermissionRespond={sendPermissionResponse}
                            isRespondingToPermission={isRespondingToPermission}
                        />
                        <ChatInput
                            onSend={sendMessage}
                            onDraftChange={(content: string) => {
                                if (!activeSessionId) {
                                    return;
                                }
                                setDraftMessagesBySessionId(prev => ({
                                    ...prev,
                                    [activeSessionId]: content
                                }));
                            }}
                            onAbort={abortResponse}
                            disabled={!activeSessionId}
                            isStreaming={isStreaming}
                            draftMessage={activeDraftMessage}
                        />
                    </>
                ) : (
                    <div className="chat-empty">
                        <h3>AI Assistant</h3>
                        <p>Create a new session or select an existing one to start chatting.</p>
                        <button onClick={createSession} disabled={loading}>
                            {loading ? 'Loading...' : 'Start New Chat'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

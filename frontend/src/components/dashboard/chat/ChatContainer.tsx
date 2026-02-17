import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import { AxiosError } from 'axios';
import { axiosInstance } from '../../../utils';
import { useAuth } from '../../../lib/auth';
import type {
    ChatSession,
    Message,
    Part,
    SSEEvent
} from '../../../types/chat';
import SessionSidebar from './SessionSidebar';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import './Chat.css';

export default function ChatContainer() {
    const auth = useAuth();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [parts, setParts] = useState<Part[]>([]);
    const [loading, setLoading] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const lastEscapePressRef = useRef<number>(0);
    const currentSessionInfoRef = useRef<{ id: string; isEmpty: boolean } | null>(null);

    const token = auth.loading ? null : auth.token;

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

            const data = response.data.messages;
            if (Array.isArray(data)) {
                // The API returns an array of { info: Message, parts: Part[] } objects
                const loadedMessages: Message[] = [];
                const loadedParts: Part[] = [];

                data.forEach((item: { info: Message; parts: Part[] }) => {
                    loadedMessages.push(item.info);
                    loadedParts.push(...item.parts);
                });

                setMessages(loadedMessages);
                setParts(loadedParts);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load messages';
            toast.error(errorMessage);
        }
    }, [token]);

    // Load sessions on mount
    useEffect(() => {
        if (!token) return;
        loadSessions();
    }, [token, loadSessions]);

    // Load messages when active session changes
    useEffect(() => {
        if (activeSessionId) {
            loadMessages(activeSessionId);
            startSSE(activeSessionId);
        } else {
            setMessages([]);
            setParts([]);
        }

        return () => {
            stopSSE();
        };
    }, [activeSessionId, loadMessages, startSSE, stopSSE]);

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

    const createSession = async () => {
        if (!token) return;

        // If current session is empty, don't create a new one
        if (activeSessionId && messages.length === 0) {
            return;
        }

        try {
            const response = await axiosInstance.post('/api/chat/sessions', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const newSession = response.data.session;
            setSessions(prev => [newSession, ...prev]);
            // Use switchSession to clean up any previous empty session
            switchSession(newSession.id);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to create session';
            toast.error(errorMessage);
        }
    };

    const deleteSession = async (sessionId: string) => {
        if (!token) return;

        try {
            await axiosInstance.delete(`/api/chat/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setSessions(prev => prev.filter(s => s.id !== sessionId));
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

    // Track whether current session is empty
    useEffect(() => {
        if (activeSessionId) {
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

        // Optimistically add user message to UI
        const tempUserMessage: Message = {
            id: `temp-${Date.now()}`,
            sessionID: activeSessionId,
            role: 'user',
            time: { created: Date.now() }
        };
        const tempTextPart: Part = {
            id: `temp-part-${Date.now()}`,
            sessionID: activeSessionId,
            messageID: tempUserMessage.id,
            type: 'text',
            text: content
        };
        setMessages(prev => [...prev, tempUserMessage]);
        setParts(prev => [...prev, tempTextPart]);

        try {
            setIsStreaming(true);
            await axiosInstance.post(
                `/api/chat/sessions/${activeSessionId}/messages`,
                { content },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            // The real message will appear through SSE events and replace our temp one
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to send message';
            toast.error(errorMessage);
            setIsStreaming(false);
            // Remove temp message on error
            setMessages(prev => prev.filter(m => m.id !== tempUserMessage.id));
            setParts(prev => prev.filter(p => p.id !== tempTextPart.id));
        }
    };

    const abortResponse = useCallback(async () => {
        if (!token || !activeSessionId) return;

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
                        />
                        <ChatInput
                            onSend={sendMessage}
                            onAbort={abortResponse}
                            disabled={!activeSessionId}
                            isStreaming={isStreaming}
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

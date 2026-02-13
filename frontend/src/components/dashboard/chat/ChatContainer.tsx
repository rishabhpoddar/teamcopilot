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
    const { token } = useAuth();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [parts, setParts] = useState<Part[]>([]);
    const [loading, setLoading] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
    }, [token]);

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
    }, [activeSessionId]);

    const loadSessions = async () => {
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
    };

    const loadMessages = async (sessionId: string) => {
        if (!token) return;

        try {
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/messages`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const data = response.data.messages;
            if (Array.isArray(data)) {
                // The API returns an array of [message, parts[]] tuples
                const loadedMessages: Message[] = [];
                const loadedParts: Part[] = [];

                data.forEach((item: [Message, Part[]]) => {
                    loadedMessages.push(item[0]);
                    loadedParts.push(...item[1]);
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
    };

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
    }, [token]);

    const stopSSE = () => {
        if (readerRef.current) {
            readerRef.current.cancel();
            readerRef.current = null;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    const handleSSEEvent = (event: SSEEvent) => {
        switch (event.type) {
            case 'message.updated': {
                const { info } = event.properties;
                setMessages(prev => {
                    const exists = prev.find(m => m.id === info.id);
                    if (exists) {
                        return prev.map(m => m.id === info.id ? info : m);
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
                    return [...prev, part];
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
                const errorMsg = event.properties.error.data.message || event.properties.error.name;
                toast.error(`AI Error: ${errorMsg}`);
                setIsStreaming(false);
                break;
            }

            case 'session.status': {
                const status = event.properties.status;
                if (status.type === 'idle') {
                    setIsStreaming(false);
                } else if (status.type === 'running' || status.type === 'waiting') {
                    setIsStreaming(true);
                }
                break;
            }
        }
    };

    const createSession = async () => {
        if (!token) return;

        try {
            const response = await axiosInstance.post('/api/chat/sessions', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const newSession = response.data.session;
            setSessions(prev => [newSession, ...prev]);
            setActiveSessionId(newSession.id);
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
                setActiveSessionId(null);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to delete session';
            toast.error(errorMessage);
        }
    };

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

    const abortResponse = async () => {
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
    };

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
                onSelectSession={setActiveSessionId}
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

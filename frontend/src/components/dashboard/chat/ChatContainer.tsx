import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import { AxiosError, CanceledError } from 'axios';
import { axiosInstance, assertMessagesPayload, assertSessionStatus } from '../../../utils';
import { useAuth } from '../../../lib/auth';
import type {
    ChatSession,
    ChatSessionDiffResponse,
    Message,
    Part,
    SSEEvent,
    ToolPart,
    PermissionRequest
} from '../../../types/chat';
import SessionSidebar from './SessionSidebar';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import SessionFileDiffPanel from './SessionFileDiffPanel';
import './Chat.css';

interface ChatInputSendPayload {
    content: string;
    filePaths: string[];
}

interface ChatContainerProps {
    initialDraftMessage: string | null;
    forceNewChat: boolean;
    onDraftHandled: () => void;
}

function getSessionErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
        return 'The assistant failed to respond';
    }

    const candidate = error as {
        name?: unknown;
        message?: unknown;
        data?: {
            message?: unknown;
        };
    };

    if (typeof candidate.data?.message === 'string' && candidate.data.message.trim().length > 0) {
        return candidate.data.message;
    }

    if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
        return candidate.message;
    }

    if (typeof candidate.name === 'string' && candidate.name.trim().length > 0) {
        return candidate.name;
    }

    return 'The assistant failed to respond';
}

function isDocumentVisibleAndFocused(): boolean {
    return document.visibilityState === 'visible' && document.hasFocus();
}

type AttentionDeliveryState = {
    messageId: string;
    delivery: 'notified' | 'seen';
};

function playNotificationSound() {
    const AudioContextConstructor = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

    if (!AudioContextConstructor) {
        return;
    }

    const audioContext = new AudioContextConstructor();
    const masterGain = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    const startTime = audioContext.currentTime + 0.01;

    masterGain.gain.setValueAtTime(0.0001, startTime);
    masterGain.gain.exponentialRampToValueAtTime(0.8, startTime + 0.012);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.95);

    compressor.threshold.setValueAtTime(-8, startTime);
    compressor.knee.setValueAtTime(12, startTime);
    compressor.ratio.setValueAtTime(2, startTime);
    compressor.attack.setValueAtTime(0.0005, startTime);
    compressor.release.setValueAtTime(0.08, startTime);

    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);

    const notes = [
        { frequency: 783.99, offset: 0, duration: 0.24, gain: 0.42, type: 'triangle' as const },
        { frequency: 1046.5, offset: 0.11, duration: 0.28, gain: 0.38, type: 'triangle' as const },
        { frequency: 1318.51, offset: 0.22, duration: 0.46, gain: 0.34, type: 'triangle' as const }
    ];

    const oscillators: OscillatorNode[] = [];

    for (const note of notes) {
        const oscillator = audioContext.createOscillator();
        const overtoneOscillator = audioContext.createOscillator();
        const noteGain = audioContext.createGain();
        const noteStart = startTime + note.offset;
        const noteEnd = noteStart + note.duration;

        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, noteStart);
        oscillator.frequency.exponentialRampToValueAtTime(note.frequency * 1.015, noteEnd);

        overtoneOscillator.type = 'sine';
        overtoneOscillator.frequency.setValueAtTime(note.frequency * 2, noteStart);
        overtoneOscillator.frequency.exponentialRampToValueAtTime(note.frequency * 2.02, noteEnd);

        noteGain.gain.setValueAtTime(0.0001, noteStart);
        noteGain.gain.exponentialRampToValueAtTime(note.gain, noteStart + 0.01);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        oscillator.connect(noteGain);
        overtoneOscillator.connect(noteGain);
        noteGain.connect(masterGain);
        oscillator.start(noteStart);
        overtoneOscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.02);
        overtoneOscillator.stop(noteEnd + 0.02);
        oscillators.push(oscillator);
    }

    const lastOscillator = oscillators[oscillators.length - 1];
    lastOscillator?.addEventListener('ended', () => {
        void audioContext.close();
    });
}

export default function ChatContainer({ initialDraftMessage, forceNewChat, onDraftHandled }: ChatContainerProps) {
    const PENDING_SESSION_ID = 'pending';
    const PERMISSION_POLL_INTERVAL_MS = 1000;
    const SESSION_DIFF_POLL_INTERVAL_MS = 1000;
    const SESSION_LIST_POLL_INTERVAL_MS = 2000;
    const MOBILE_BREAKPOINT_PX = 820;
    const auth = useAuth();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window === 'undefined') {
            return true;
        }
        return window.innerWidth > MOBILE_BREAKPOINT_PX;
    });
    const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useState(() => {
        if (typeof window === 'undefined') {
            return true;
        }
        return window.innerWidth > MOBILE_BREAKPOINT_PX;
    });
    const [messages, setMessages] = useState<Message[]>([]);
    const [parts, setParts] = useState<Part[]>([]);
    const [loading, setLoading] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionDiff, setSessionDiff] = useState<ChatSessionDiffResponse | null>(null);
    const [sessionDiffLoading, setSessionDiffLoading] = useState(false);
    const [sessionDiffError, setSessionDiffError] = useState<string | null>(null);
    const [expandedDiffPaths, setExpandedDiffPaths] = useState<string[]>([]);
    const draftMessagesBySessionIdRef = useRef<Record<string, string>>({});
    const [draftRevisionBySessionId, setDraftRevisionBySessionId] = useState<Record<string, number>>({});
    const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
    const [respondingPermissionIds, setRespondingPermissionIds] = useState<Record<string, boolean>>({});
    const [attentionStateBySessionId, setAttentionStateBySessionId] = useState<Record<string, AttentionDeliveryState>>(
        {}
    );

    const abortControllerRef = useRef<AbortController | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const completedAssistantMessageIdsRef = useRef<Set<string>>(new Set());
    const syncedUsageMessageIdsRef = useRef<Set<string>>(new Set());
    const lastEscapePressRef = useRef<number>(0);
    // const currentSessionInfoRef = useRef<{ id: string; isEmpty: boolean } | null>(null);
    const handledComposeKeyRef = useRef<string | null>(null);
    const previousSessionsRef = useRef<Record<string, ChatSession>>({});
    const readingSessionIdsRef = useRef<Set<string>>(new Set());
    const messagesAbortControllerRef = useRef<AbortController | null>(null);
    const pendingPermissionsAbortControllerRef = useRef<AbortController | null>(null);
    const sessionDiffAbortControllerRef = useRef<AbortController | null>(null);

    const updateDraftForSession = useCallback((sessionId: string, content: string) => {
        draftMessagesBySessionIdRef.current[sessionId] = content;
    }, []);

    const clearDraftForSession = useCallback((sessionId: string) => {
        delete draftMessagesBySessionIdRef.current[sessionId];
    }, []);

    const refreshDraftForSession = useCallback((sessionId: string) => {
        setDraftRevisionBySessionId((prev) => ({
            ...prev,
            [sessionId]: (prev[sessionId] ?? 0) + 1
        }));
    }, []);

    const abortSessionDataRequests = useCallback(() => {
        messagesAbortControllerRef.current?.abort();
        messagesAbortControllerRef.current = null;
        pendingPermissionsAbortControllerRef.current?.abort();
        pendingPermissionsAbortControllerRef.current = null;
        sessionDiffAbortControllerRef.current?.abort();
        sessionDiffAbortControllerRef.current = null;
    }, []);

    const resetSessionViewState = useCallback(() => {
        abortSessionDataRequests();
        setMessages([]);
        setParts([]);
        setPendingPermissions([]);
        setRespondingPermissionIds({});
        setSessionDiff(null);
        setSessionDiffError(null);
        setSessionDiffLoading(false);
        setExpandedDiffPaths([]);
        setIsStreaming(false);
        completedAssistantMessageIdsRef.current = new Set();
        syncedUsageMessageIdsRef.current = new Set();
    }, [abortSessionDataRequests]);

    const token = auth.loading ? null : auth.token;
    const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > MOBILE_BREAKPOINT_PX) {
                setIsSidebarOpen(true);
                setIsDiffSidebarOpen(true);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (token) {
            return;
        }
        setLoading(true);
        setAttentionStateBySessionId({});
        previousSessionsRef.current = {};
        readingSessionIdsRef.current = new Set();
    }, [token]);

    const assertPermissionHasToolCall = useCallback((permission: PermissionRequest): PermissionRequest => {
        const tool = permission.tool as { messageID?: unknown; callID?: unknown };
        if (!tool || typeof tool.messageID !== 'string' || typeof tool.callID !== 'string') {
            throw new Error(`Permission '${permission.id}' is missing required tool.messageID/callID`);
        }
        return permission;
    }, []);

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

    const syncUsageForSession = useCallback(async (sessionId: string) => {
        if (!token || sessionId === PENDING_SESSION_ID) {
            return;
        }

        try {
            await axiosInstance.post(
                `/api/chat/sessions/${sessionId}/sync-usage`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch {
            // Usage analytics are best-effort estimates.
        }
    }, [token]);

    const handleSSEEvent = useCallback((event: SSEEvent) => {
        switch (event.type) {
            case 'message.updated': {
                const { info } = event.properties;
                if (info.role === 'assistant') {
                    if (info.time.completed) {
                        completedAssistantMessageIdsRef.current.add(info.id);
                        if (
                            activeSessionId
                            && activeSessionId !== PENDING_SESSION_ID
                            && !syncedUsageMessageIdsRef.current.has(info.id)
                        ) {
                            syncedUsageMessageIdsRef.current.add(info.id);
                            void syncUsageForSession(activeSessionId);
                        }
                    } else if (completedAssistantMessageIdsRef.current.has(info.id)) {
                        // Ignore stale out-of-order updates that regress a completed assistant message.
                        break;
                    }
                }

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
                const message = getSessionErrorMessage(event.properties.error);
                if (message !== 'User aborted') {
                    toast.error(message);
                }
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
                const normalizedPermission = assertPermissionHasToolCall(event.properties);
                setPendingPermissions((prev) => {
                    const exists = prev.some((permission) => permission.id === normalizedPermission.id);
                    if (exists) {
                        return prev.map((permission) => permission.id === normalizedPermission.id ? normalizedPermission : permission);
                    }
                    return [...prev, normalizedPermission];
                });
                break;
            }

            case 'permission.replied': {
                setPendingPermissions((prev) =>
                    prev.filter((permission) =>
                        !(permission.sessionID === event.properties.sessionID && permission.id === event.properties.requestID)
                    )
                );
                setRespondingPermissionIds((prev) => {
                    const next = { ...prev };
                    delete next[event.properties.requestID];
                    return next;
                });
                break;
            }
        }
    }, [activeSessionId, assertPermissionHasToolCall, syncUsageForSession]);

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

    const updateAttentionState = useCallback((sessionId: string, nextState: AttentionDeliveryState | null) => {
        setAttentionStateBySessionId((prev) => {
            if (nextState === null) {
                if (!(sessionId in prev)) {
                    return prev;
                }
                const next = { ...prev };
                delete next[sessionId];
                return next;
            }

            return {
                ...prev,
                [sessionId]: nextState
            };
        });
    }, []);

    const markSessionAsRead = useCallback(async (sessionId: string) => {
        if (!token || sessionId === PENDING_SESSION_ID || readingSessionIdsRef.current.has(sessionId)) {
            return;
        }

        try {
            readingSessionIdsRef.current.add(sessionId);
            await axiosInstance.post(
                `/api/chat/sessions/${sessionId}/read`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            updateAttentionState(sessionId, null);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to mark session as read';
            toast.error(errorMessage);
        } finally {
            readingSessionIdsRef.current.delete(sessionId);
        }
    }, [token, updateAttentionState]);

    const markAttentionSessionAsSeen = useCallback((session: Extract<ChatSession, { state: 'attention' }>) => {
        void markSessionAsRead(session.id);
        updateAttentionState(session.id, {
            messageId: session.latest_message_id,
            delivery: 'seen'
        });
    }, [markSessionAsRead, updateAttentionState]);

    const loadSessions = useCallback(async () => {
        if (!token) return;

        const isInitialLoad = loading;

        try {
            if (isInitialLoad) {
                setLoading(true);
            }
            const response = await axiosInstance.get('/api/chat/sessions', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const nextSessions = Array.isArray(response.data?.sessions) ? response.data.sessions as ChatSession[] : [];
            const previousSessions = previousSessionsRef.current;

            if (!isInitialLoad) {
                for (const nextSession of nextSessions) {
                    const previousSession = previousSessions[nextSession.id];
                    if (!previousSession) {
                        continue;
                    }

                    const previousAttentionMessageId = previousSession.state === 'attention'
                        ? previousSession.latest_message_id
                        : null;
                    if (nextSession.state !== 'attention') {
                        updateAttentionState(nextSession.id, null);
                        continue;
                    }
                    const nextAttentionMessageId = nextSession.latest_message_id;
                    if (previousAttentionMessageId === nextAttentionMessageId && previousSession.state === nextSession.state) {
                        continue;
                    }

                    const previousDelivery = attentionStateBySessionId[nextSession.id];
                    const shouldSuppressAsDuplicate = previousAttentionMessageId !== null
                        && previousDelivery?.messageId === previousAttentionMessageId
                        && previousDelivery.delivery === 'notified';

                    const isSeenNow = nextSession.id === activeSessionId && isDocumentVisibleAndFocused();
                    if (isSeenNow) {
                        markAttentionSessionAsSeen(nextSession);
                        continue;
                    }

                    if (shouldSuppressAsDuplicate) {
                        updateAttentionState(nextSession.id, {
                            messageId: nextAttentionMessageId,
                            delivery: 'notified'
                        });
                        continue;
                    }

                    updateAttentionState(nextSession.id, {
                        messageId: nextAttentionMessageId,
                        delivery: 'notified'
                    });

                    if ('Notification' in window) {
                        if (Notification.permission === 'granted') {
                            new Notification(nextSession.title || 'New Chat', {
                                body: 'This chat needs your attention.'
                            });
                        } else if (Notification.permission === 'default') {
                            void Notification.requestPermission().then((permission) => {
                                if (permission === 'granted') {
                                    new Notification(nextSession.title || 'New Chat', {
                                        body: 'This chat needs your attention.'
                                    });
                                }
                            });
                        }
                    }

                    playNotificationSound();
                }
            }

            previousSessionsRef.current = nextSessions.reduce<Record<string, ChatSession>>((acc, session) => {
                acc[session.id] = session;
                return acc;
            }, {});
            setSessions(nextSessions);
            if (activeSessionId && activeSessionId !== PENDING_SESSION_ID) {
                const stillExists = nextSessions.some((session) => session.id === activeSessionId);
                if (!stillExists) {
                    resetSessionViewState();
                    setActiveSessionId(null);
                }
            }
            setError(null);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load sessions';
            setError(errorMessage);
        } finally {
            if (isInitialLoad) {
                setLoading(false);
            }
        }
    }, [activeSessionId, attentionStateBySessionId, loading, markAttentionSessionAsSeen, resetSessionViewState, token, updateAttentionState]);

    const markActiveAttentionAsSeenIfVisible = useCallback(() => {
        if (!activeSession || activeSession.id === PENDING_SESSION_ID) {
            return;
        }

        if (activeSession.state !== 'attention') {
            return;
        }

        if (!isDocumentVisibleAndFocused()) {
            return;
        }

        markAttentionSessionAsSeen(activeSession);
    }, [activeSession, markAttentionSessionAsSeen]);

    const loadMessages = useCallback(async (sessionId: string) => {
        if (!token) return;

        messagesAbortControllerRef.current?.abort();
        const controller = new AbortController();
        messagesAbortControllerRef.current = controller;
        try {
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/messages`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal
            });
            if (messagesAbortControllerRef.current !== controller || controller.signal.aborted) {
                return;
            }

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
            completedAssistantMessageIdsRef.current = new Set(
                loadedMessages
                    .filter((message) => message.role === 'assistant' && Boolean(message.time.completed))
                    .map((message) => message.id)
            );
            syncedUsageMessageIdsRef.current = new Set(completedAssistantMessageIdsRef.current);
            if (loadedMessages.some((message) => message.role === 'assistant' && Boolean(message.time.completed))) {
                void syncUsageForSession(sessionId);
            }
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
            if (err instanceof CanceledError) {
                return;
            }
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load messages';
            toast.error(errorMessage);
        } finally {
            if (messagesAbortControllerRef.current === controller) {
                messagesAbortControllerRef.current = null;
            }
        }
    }, [syncUsageForSession, token]);

    const loadPendingPermissions = useCallback(async (sessionId: string) => {
        if (!token) return;

        pendingPermissionsAbortControllerRef.current?.abort();
        const controller = new AbortController();
        pendingPermissionsAbortControllerRef.current = controller;
        try {
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/pending-permission`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal
            });
            if (pendingPermissionsAbortControllerRef.current !== controller || controller.signal.aborted) {
                return;
            }
            const permissionsPayload = response.data?.permissions;
            if (!Array.isArray(permissionsPayload)) {
                throw new Error('Missing permissions array in pending-permission response');
            }
            const normalizedPermissions = permissionsPayload as PermissionRequest[];
            setPendingPermissions(normalizedPermissions.map(assertPermissionHasToolCall));
        } catch (err: unknown) {
            if (err instanceof CanceledError) {
                return;
            }
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load permission state';
            setError(`${errorMessage}. Please reload the page.`);
        } finally {
            if (pendingPermissionsAbortControllerRef.current === controller) {
                pendingPermissionsAbortControllerRef.current = null;
            }
        }
    }, [token, assertPermissionHasToolCall]);

    const loadSessionDiff = useCallback(async (sessionId: string, options?: { showLoading?: boolean }) => {
        if (!token) {
            return;
        }

        const showLoading = options?.showLoading !== false;
        if (sessionDiffAbortControllerRef.current) {
            sessionDiffAbortControllerRef.current.abort();
            setSessionDiffLoading(false);
        }
        const controller = new AbortController();
        sessionDiffAbortControllerRef.current = controller;
        try {
            if (showLoading) {
                setSessionDiffLoading(true);
            }
            setSessionDiffError(null);
            const response = await axiosInstance.get(`/api/chat/sessions/${sessionId}/file-diff`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal
            });
            if (sessionDiffAbortControllerRef.current !== controller || controller.signal.aborted) {
                return;
            }
            const nextDiff = response.data as ChatSessionDiffResponse;
            setSessionDiff(nextDiff);
            setExpandedDiffPaths((prev) => {
                const validExpandedPaths = prev.filter((path) => nextDiff.files.some((file) => file.path === path));
                return validExpandedPaths;
            });
        } catch (err: unknown) {
            if (err instanceof CanceledError) {
                return;
            }
            if (showLoading) {
                const errorMessage = err instanceof AxiosError
                    ? err.response?.data?.message || err.response?.data || err.message
                    : 'Failed to load session diff';
                setSessionDiffError(String(errorMessage));
            }
        } finally {
            if (sessionDiffAbortControllerRef.current === controller) {
                sessionDiffAbortControllerRef.current = null;
                if (showLoading) {
                    setSessionDiffLoading(false);
                }
            }
        }
    }, [token]);

    // Load sessions on mount
    useEffect(() => {
        if (!token) return;
        loadSessions();
    }, [token, loadSessions]);

    useEffect(() => {
        if (!token) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadSessions();
        }, SESSION_LIST_POLL_INTERVAL_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [loadSessions, token]);

    useEffect(() => {
        markActiveAttentionAsSeenIfVisible();
    }, [markActiveAttentionAsSeenIfVisible]);

    useEffect(() => {
        window.addEventListener('focus', markActiveAttentionAsSeenIfVisible);
        document.addEventListener('visibilitychange', markActiveAttentionAsSeenIfVisible);

        return () => {
            window.removeEventListener('focus', markActiveAttentionAsSeenIfVisible);
            document.removeEventListener('visibilitychange', markActiveAttentionAsSeenIfVisible);
        };
    }, [markActiveAttentionAsSeenIfVisible]);

    // Load messages when active session changes
    useEffect(() => {
        if (activeSessionId && activeSessionId !== PENDING_SESSION_ID) {
            loadMessages(activeSessionId);
            loadPendingPermissions(activeSessionId);
            void loadSessionDiff(activeSessionId);
            startSSE(activeSessionId);
        } else {
            resetSessionViewState();
        }

        return () => {
            stopSSE();
        };
    }, [activeSessionId, loadMessages, loadPendingPermissions, loadSessionDiff, resetSessionViewState, startSSE, stopSSE]);

    /*
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
    */

    const switchSession = useCallback((newSessionId: string | null) => {
        // // Clean up previous empty session
        // const prev = currentSessionInfoRef.current;
        // if (prev && prev.isEmpty && prev.id !== newSessionId) {
        //     deleteSessionSilently(prev.id);
        // }
        if (newSessionId !== activeSessionId) {
            resetSessionViewState();
        }
        setActiveSessionId(newSessionId);
        if (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX) {
            setIsSidebarOpen(false);
        }
    }, [activeSessionId, resetSessionViewState]);

    const createSession = useCallback(() => {
        // If already in pending new chat mode, do nothing
        if (activeSessionId === PENDING_SESSION_ID) {
            return;
        }

        // Switch to pending mode - session will be created when first message is sent
        switchSession(PENDING_SESSION_ID);
    }, [activeSessionId, switchSession]);

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
            updateDraftForSession(targetSessionId, initialDraftMessage);
            refreshDraftForSession(targetSessionId);
        }
        onDraftHandled();
    }, [forceNewChat, initialDraftMessage, activeSessionId, onDraftHandled, createSession, refreshDraftForSession, updateDraftForSession]);

    /*
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
    */

    const searchMentionFiles = useCallback(async (query: string): Promise<string[]> => {
        if (!token) {
            return [];
        }

        try {
            const response = await axiosInstance.get<{ files: string[] }>('/api/chat/file-suggestions', {
                params: { query, limit: 10 },
                headers: { Authorization: `Bearer ${token}` }
            });
            return Array.isArray(response.data?.files) ? response.data.files : [];
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to fetch file suggestions';
            throw new Error(String(errorMessage));
        }
    }, [token]);

    const sendMessage = useCallback(async ({ content, filePaths }: ChatInputSendPayload) => {
        if (!token || !activeSessionId) return;

        const isPending = activeSessionId === PENDING_SESSION_ID;
        let tempUserMessage: Message | null = null;
        let tempParts: Part[] = [];

        // Optimistically add user message to UI
        tempUserMessage = {
            id: `temp-${Date.now()}`,
            sessionID: 'temp',
            role: 'user',
            time: { created: Date.now() }
        };
        const now = Date.now();
        const tempTextPart: Part = {
            id: `temp-part-${Date.now()}`,
            sessionID: 'temp',
            messageID: tempUserMessage.id,
            type: 'text',
            text: content
        };
        const tempFileParts: Part[] = filePaths.map((filePath, index) => ({
            id: `temp-file-part-${now}-${index}`,
            sessionID: 'temp',
            messageID: tempUserMessage!.id,
            type: 'file',
            mime: 'text/plain',
            filename: filePath.split('/').pop(),
            url: filePath
        }));
        tempParts = [tempTextPart, ...tempFileParts];
        setMessages(prev => [...prev, tempUserMessage!]);
        setParts(prev => [...prev, ...tempParts]);

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
                clearDraftForSession(PENDING_SESSION_ID);
                sessionId = newSession.id;
                // Start SSE for the new session
                startSSE(newSession.id);
            }

            // Send the message
            const parts: Array<{ type: 'text'; text: string } | { type: 'file'; path: string }> = [
                { type: 'text', text: content },
                ...filePaths.map((filePath) => ({ type: 'file' as const, path: filePath }))
            ];
            const sendResponse = await axiosInstance.post(
                `/api/chat/sessions/${sessionId}/messages`,
                { parts },
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
            const tempPartIds = new Set(tempParts.map((part) => part.id));
            setParts(prev => prev.filter(p => !tempPartIds.has(p.id)));
            // If we were pending, go back to pending state
            if (isPending) {
                setActiveSessionId(PENDING_SESSION_ID);
            }
        }
    }, [activeSessionId, clearDraftForSession, startSSE, token]);

    const sendToolAnswer = useCallback(async (content: string) => {
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
    }, [token, activeSessionId]);

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

    const sendPermissionResponse = useCallback(async (permissionId: string, response: "once" | "always" | "reject") => {
        if (!token || !activeSessionId || activeSessionId === PENDING_SESSION_ID) return;

        try {
            setRespondingPermissionIds((prev) => ({
                ...prev,
                [permissionId]: true
            }));
            await axiosInstance.post(
                `/api/chat/sessions/${activeSessionId}/permission-response`,
                { response, permission_id: permissionId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setPendingPermissions((prev) => prev.filter((permission) => permission.id !== permissionId));
            await loadPendingPermissions(activeSessionId);
            void loadMessages(activeSessionId);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to send permission response';
            toast.error(errorMessage);
        } finally {
            setRespondingPermissionIds((prev) => {
                const next = { ...prev };
                delete next[permissionId];
                return next;
            });
        }
    }, [token, activeSessionId, loadPendingPermissions, loadMessages]);

    useEffect(() => {
        if (!activeSessionId || activeSessionId === PENDING_SESSION_ID || !isStreaming) {
            return;
        }

        let cancelled = false;

        const poll = async () => {
            while (!cancelled) {
                await loadPendingPermissions(activeSessionId);
                await new Promise((resolve) => window.setTimeout(resolve, PERMISSION_POLL_INTERVAL_MS));
            }
        };

        void poll();

        return () => {
            cancelled = true;
        };
    }, [activeSessionId, isStreaming, loadPendingPermissions]);

    useEffect(() => {
        if (!activeSessionId || activeSessionId === PENDING_SESSION_ID || isStreaming) {
            return;
        }
        void loadSessionDiff(activeSessionId);
    }, [activeSessionId, isStreaming, loadSessionDiff]);

    useEffect(() => {
        if (!activeSessionId || activeSessionId === PENDING_SESSION_ID) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadSessionDiff(activeSessionId, { showLoading: false });
        }, SESSION_DIFF_POLL_INTERVAL_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [activeSessionId, loadSessionDiff]);

    const activeDraftMessage = activeSessionId ? (draftMessagesBySessionIdRef.current[activeSessionId] ?? '') : '';
    const activeDraftRevision = activeSessionId ? (draftRevisionBySessionId[activeSessionId] ?? 0) : 0;
    const activeDraftSessionKey = activeSessionId ? `${activeSessionId}:${activeDraftRevision}` : 'no-session';
    const hasVisibleSessionDiff = Boolean(sessionDiff && sessionDiff.files.length > 0);
    const toggleExpandedDiffPath = useCallback((path: string) => {
        setExpandedDiffPaths((prev) => (
            prev.includes(path)
                ? prev.filter((item) => item !== path)
                : [...prev, path]
        ));
    }, []);

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
            {/* Previously used: onDeleteSession={deleteSession} */}
            <SessionSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                attentionStateBySessionId={attentionStateBySessionId}
                onSelectSession={switchSession}
                onNewSession={createSession}
                isOpen={isSidebarOpen}
                onToggle={() => setIsSidebarOpen((prev) => !prev)}
                loading={loading}
            />
            <div className="chat-main">
                <div className="chat-main-toolbar">
                    <button
                        type="button"
                        className="chat-main-toolbar-toggle"
                        onClick={() => setIsSidebarOpen((prev) => !prev)}
                        aria-expanded={isSidebarOpen}
                        aria-controls="chat-session-list"
                    >
                        Sessions
                    </button>
                    {hasVisibleSessionDiff ? (
                        <button
                            type="button"
                            className="chat-main-toolbar-toggle"
                            onClick={() => setIsDiffSidebarOpen((prev) => !prev)}
                            aria-expanded={isDiffSidebarOpen}
                            aria-controls="chat-session-diff"
                        >
                            Diff
                        </button>
                    ) : null}
                    <div className="chat-main-toolbar-meta">
                        <strong>{activeSession?.title || (activeSessionId ? 'New Chat' : 'AI Assistant')}</strong>
                        <span>
                            {activeSessionId
                                ? 'Fixed viewport with scrollable conversation'
                                : 'Select a session or start a new chat'}
                        </span>
                    </div>
                </div>
                {activeSessionId ? (
                    <div className="chat-workspace without-diff">
                        <div className="chat-column chat-column-main">
                            <MessageList
                                sessionKey={activeSessionId}
                                messages={messages}
                                parts={parts}
                                isStreaming={isStreaming}
                                isWaitingForInput={isWaitingForInput || pendingPermissions.length > 0}
                                onAnswer={sendToolAnswer}
                                pendingPermissions={pendingPermissions}
                                onPermissionRespond={sendPermissionResponse}
                                respondingPermissionIds={respondingPermissionIds}
                            />
                            <ChatInput
                                onSend={sendMessage}
                                fetchFileSuggestions={searchMentionFiles}
                                draftSessionKey={activeDraftSessionKey}
                                onDraftChange={(content: string) => {
                                    if (!activeSessionId) {
                                        return;
                                    }
                                    updateDraftForSession(activeSessionId, content);
                                }}
                                onAbort={abortResponse}
                                disabled={!activeSessionId}
                                isStreaming={isStreaming}
                                draftMessage={activeDraftMessage}
                            />
                        </div>
                    </div>
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
            {hasVisibleSessionDiff ? (
                <SessionFileDiffPanel
                    diff={sessionDiff}
                    loading={sessionDiffLoading}
                    error={sessionDiffError}
                    expandedPaths={expandedDiffPaths}
                    onSelectPath={toggleExpandedDiffPath}
                    onRefresh={() => {
                        if (activeSessionId && activeSessionId !== PENDING_SESSION_ID) {
                            void loadSessionDiff(activeSessionId);
                        }
                    }}
                    isOpen={isDiffSidebarOpen}
                    onToggle={() => setIsDiffSidebarOpen((prev) => !prev)}
                />
            ) : null}
        </div>
    );
}

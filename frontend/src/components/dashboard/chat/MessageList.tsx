import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, Part, PermissionRequest } from '../../../types/chat';
import MessageItem from './MessageItem';

interface MessageListProps {
    sessionKey: string;
    messages: Message[];
    parts: Part[];
    isStreaming: boolean;
    isWaitingForInput: boolean;
    onAnswer: (answer: string) => void;
    pendingPermissions: PermissionRequest[];
    onPermissionRespond: (permissionId: string, response: "once" | "always" | "reject") => void;
    respondingPermissionIds: Record<string, boolean>;
}

function MessageList({
    sessionKey,
    messages,
    parts,
    isStreaming,
    isWaitingForInput,
    onAnswer,
    pendingPermissions,
    onPermissionRespond,
    respondingPermissionIds
}: MessageListProps) {
    const BOTTOM_THRESHOLD_PX = 24;
    const TOP_LOAD_THRESHOLD_PX = 72;
    const INITIAL_VISIBLE_MESSAGES = 5;
    const LOAD_MORE_STEP = 5;
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const [visibleStartMessageId, setVisibleStartMessageId] = useState<string | null>(null);
    const pendingScrollRestoreRef = useRef<number | null>(null);
    const previousSessionKeyRef = useRef(sessionKey);
    const visibleStartIndex = useMemo(() => {
        if (messages.length === 0) {
            return 0;
        }

        if (!visibleStartMessageId) {
            return Math.max(messages.length - INITIAL_VISIBLE_MESSAGES, 0);
        }

        const matchedIndex = messages.findIndex((message) => message.id === visibleStartMessageId);
        if (matchedIndex === -1) {
            return Math.max(messages.length - INITIAL_VISIBLE_MESSAGES, 0);
        }

        return matchedIndex;
    }, [messages, visibleStartMessageId]);
    const visibleMessages = useMemo(
        () => messages.slice(visibleStartIndex),
        [messages, visibleStartIndex]
    );
    const visibleMessageIds = useMemo(
        () => new Set(visibleMessages.map((message) => message.id)),
        [visibleMessages]
    );
    const partsByMessageId = useMemo(() => {
        const grouped = new Map<string, Part[]>();
        for (const part of parts) {
            if (!visibleMessageIds.has(part.messageID)) {
                continue;
            }
            const existing = grouped.get(part.messageID);
            if (existing) {
                existing.push(part);
            } else {
                grouped.set(part.messageID, [part]);
            }
        }
        return grouped;
    }, [parts, visibleMessageIds]);
    const isAtBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            return true;
        }
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    }, []);

    const handleScroll = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            return;
        }

        setShouldAutoScroll(isAtBottom());
        if (container.scrollTop > TOP_LOAD_THRESHOLD_PX || visibleStartIndex === 0) {
            return;
        }

        pendingScrollRestoreRef.current = container.scrollHeight;
        const nextStartIndex = Math.max(visibleStartIndex - LOAD_MORE_STEP, 0);
        setVisibleStartMessageId(messages[nextStartIndex]?.id ?? null);
    }, [isAtBottom, messages, visibleStartIndex]);

    useEffect(() => {
        if (previousSessionKeyRef.current === sessionKey) {
            return;
        }

        previousSessionKeyRef.current = sessionKey;
        pendingScrollRestoreRef.current = null;
        setVisibleStartMessageId(null);
        setShouldAutoScroll(true);
    }, [sessionKey]);

    useLayoutEffect(() => {
        const previousScrollHeight = pendingScrollRestoreRef.current;
        const container = messagesContainerRef.current;
        if (previousScrollHeight === null || !container) {
            return;
        }

        const nextScrollHeight = container.scrollHeight;
        container.scrollTop += nextScrollHeight - previousScrollHeight;
        pendingScrollRestoreRef.current = null;
    }, [visibleStartIndex, visibleMessages.length]);

    useEffect(() => {
        if (!shouldAutoScroll) {
            return;
        }
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [visibleMessages, parts, isStreaming, isWaitingForInput, shouldAutoScroll]);

    if (messages.length === 0) {
        return (
            <div className="chat-empty">
                <h3>Start a conversation</h3>
                <p>Send a message to begin chatting with the AI assistant.</p>
            </div>
        );
    }

    return (
        <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
            {visibleMessages.map(message => (
                <MessageItem
                    key={message.id}
                    message={message}
                    parts={partsByMessageId.get(message.id) ?? []}
                    onAnswer={onAnswer}
                    pendingPermissions={pendingPermissions}
                    onPermissionRespond={onPermissionRespond}
                    respondingPermissionIds={respondingPermissionIds}
                />
            ))}
            {isStreaming && !isWaitingForInput && (
                <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
    );
}

export default memo(MessageList);

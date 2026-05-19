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
    hasMoreOlderMessages: boolean;
    loadingOlderMessages: boolean;
    onLoadOlderMessages: () => void;
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
    respondingPermissionIds,
    hasMoreOlderMessages,
    loadingOlderMessages,
    onLoadOlderMessages,
}: MessageListProps) {
    const BOTTOM_THRESHOLD_PX = 24;
    const TOP_LOAD_THRESHOLD_PX = 72;
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const pendingScrollRestoreRef = useRef<number | null>(null);
    const needsInitialScrollToBottomRef = useRef(true);
    const previousSessionKeyRef = useRef(sessionKey);
    const partsByMessageId = useMemo(() => {
        const grouped = new Map<string, Part[]>();
        for (const part of parts) {
            const existing = grouped.get(part.messageID);
            if (existing) {
                existing.push(part);
            } else {
                grouped.set(part.messageID, [part]);
            }
        }
        return grouped;
    }, [parts]);
    const isAtBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            return true;
        }
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    }, []);

    const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const container = event.currentTarget;

        if (event.isTrusted) {
            setShouldAutoScroll(isAtBottom());
        }

        // Only load older messages from real user scrolls. Programmatic scroll/layout
        // can fire scroll events at scrollTop=0 and incorrectly prepend history.
        if (!event.isTrusted) {
            return;
        }

        if (container.scrollTop > TOP_LOAD_THRESHOLD_PX || !hasMoreOlderMessages || loadingOlderMessages) {
            return;
        }

        pendingScrollRestoreRef.current = container.scrollHeight;
        onLoadOlderMessages();
    }, [hasMoreOlderMessages, isAtBottom, loadingOlderMessages, onLoadOlderMessages]);

    useEffect(() => {
        if (previousSessionKeyRef.current === sessionKey) {
            return;
        }

        previousSessionKeyRef.current = sessionKey;
        pendingScrollRestoreRef.current = null;
        needsInitialScrollToBottomRef.current = true;
        setShouldAutoScroll(true);
    }, [sessionKey]);

    useLayoutEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            return;
        }

        const previousScrollHeight = pendingScrollRestoreRef.current;
        if (previousScrollHeight !== null) {
            const nextScrollHeight = container.scrollHeight;
            container.scrollTop += nextScrollHeight - previousScrollHeight;
            pendingScrollRestoreRef.current = null;
            return;
        }

        if (needsInitialScrollToBottomRef.current && messages.length > 0) {
            container.scrollTop = container.scrollHeight;
            needsInitialScrollToBottomRef.current = false;
        }
    }, [messages.length, parts.length]);

    useEffect(() => {
        if (!shouldAutoScroll) {
            return;
        }
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages, parts, isStreaming, isWaitingForInput, shouldAutoScroll]);

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
            {loadingOlderMessages ? (
                <div className="chat-messages-load-older" role="status">
                    Loading older messages...
                </div>
            ) : null}
            {messages.map(message => (
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

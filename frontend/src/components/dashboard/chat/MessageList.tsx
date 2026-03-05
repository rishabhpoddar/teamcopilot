import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Part, PermissionRequest } from '../../../types/chat';
import MessageItem from './MessageItem';

interface MessageListProps {
    messages: Message[];
    parts: Part[];
    isStreaming: boolean;
    isWaitingForInput: boolean;
    onAnswer: (answer: string) => void;
    pendingPermissions: PermissionRequest[];
    onPermissionRespond: (permissionId: string, response: "once" | "always" | "reject") => void;
    respondingPermissionIds: Record<string, boolean>;
}

export default function MessageList({
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
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

    const isAtBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            return true;
        }
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    }, []);

    const handleScroll = useCallback(() => {
        setShouldAutoScroll(isAtBottom());
    }, [isAtBottom]);

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
            {messages.map(message => (
                <MessageItem
                    key={message.id}
                    message={message}
                    parts={parts}
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

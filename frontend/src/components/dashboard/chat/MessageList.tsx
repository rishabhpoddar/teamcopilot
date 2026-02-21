import { useEffect, useRef } from 'react';
import type { Message, Part, PermissionRequest } from '../../../types/chat';
import MessageItem from './MessageItem';

interface MessageListProps {
    messages: Message[];
    parts: Part[];
    isStreaming: boolean;
    isWaitingForInput: boolean;
    onAnswer: (answer: string) => void;
    pendingPermission: PermissionRequest | null;
    onPermissionRespond: (response: "once" | "always" | "reject") => void;
    isRespondingToPermission: boolean;
}

export default function MessageList({
    messages,
    parts,
    isStreaming,
    isWaitingForInput,
    onAnswer,
    pendingPermission,
    onPermissionRespond,
    isRespondingToPermission
}: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, parts]);

    if (messages.length === 0) {
        return (
            <div className="chat-empty">
                <h3>Start a conversation</h3>
                <p>Send a message to begin chatting with the AI assistant.</p>
            </div>
        );
    }

    return (
        <div className="chat-messages">
            {messages.map(message => (
                <MessageItem
                    key={message.id}
                    message={message}
                    parts={parts}
                    onAnswer={onAnswer}
                    pendingPermission={pendingPermission}
                    onPermissionRespond={onPermissionRespond}
                    isRespondingToPermission={isRespondingToPermission}
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

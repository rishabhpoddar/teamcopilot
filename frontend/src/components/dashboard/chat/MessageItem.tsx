import { memo } from 'react';
import type { Message, Part, PermissionRequest } from '../../../types/chat';
import { isUserMessage, isAssistantMessage } from '../../../types/chat';
import MessagePart from './MessagePart';

interface MessageItemProps {
    message: Message;
    parts: Part[];
    onAnswer: (answer: string) => void;
    pendingPermissions: PermissionRequest[];
    onPermissionRespond: (permissionId: string, response: "once" | "always" | "reject") => void;
    respondingPermissionIds: Record<string, boolean>;
}

function MessageItem({
    message,
    parts,
    onAnswer,
    pendingPermissions,
    onPermissionRespond,
    respondingPermissionIds
}: MessageItemProps) {
    const isUser = isUserMessage(message);
    const isAssistant = isAssistantMessage(message);

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className={`message-item ${isUser ? 'user' : 'assistant'}`}>
            <div className="message-header">
                <span className="message-role">
                    {isUser ? 'You' : 'Assistant'}
                </span>
                <span className="message-time">
                    {formatTime(message.time.created)}
                </span>
            </div>
            <div className="message-content">
                {parts.map(part => (
                    <MessagePart
                        key={part.id}
                        part={part}
                        onAnswer={onAnswer}
                        pendingPermissions={pendingPermissions}
                        onPermissionRespond={onPermissionRespond}
                        respondingPermissionIds={respondingPermissionIds}
                    />
                ))}
            </div>
            {isAssistant && message.error && (
                <div className="message-error">
                    Error: {message.error.data.message || message.error.name}
                </div>
            )}
        </div>
    );
}

export default memo(MessageItem);

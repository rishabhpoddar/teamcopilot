import type { Message, Part } from '../../../types/chat';
import { isUserMessage, isAssistantMessage } from '../../../types/chat';
import MessagePart from './MessagePart';

interface MessageItemProps {
    message: Message;
    parts: Part[];
    onAnswer?: (answer: string) => void;
}

export default function MessageItem({ message, parts, onAnswer }: MessageItemProps) {
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
                {parts
                    .filter(part => part.messageID === message.id)
                    .map(part => (
                        <MessagePart key={part.id} part={part} onAnswer={onAnswer} />
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

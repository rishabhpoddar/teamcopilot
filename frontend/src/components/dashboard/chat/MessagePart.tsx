import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Part, PermissionRequest } from '../../../types/chat';
import { isTextPart, isToolPart, isReasoningPart, isFilePart } from '../../../types/chat';
import ToolCallDisplay from './ToolCallDisplay';
import QuestionToolDisplay from './QuestionToolDisplay';

interface MessagePartProps {
    part: Part;
    onAnswer?: (answer: string) => void;
    pendingPermission: PermissionRequest | null;
    onPermissionRespond: (response: "once" | "always" | "reject") => void;
    isRespondingToPermission: boolean;
}

export default function MessagePart({
    part,
    onAnswer,
    pendingPermission,
    onPermissionRespond,
    isRespondingToPermission
}: MessagePartProps) {
    if (isTextPart(part)) {
        return (
            <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {part.text}
                </ReactMarkdown>
            </div>
        );
    }

    if (isToolPart(part)) {
        // Use special display for question tool
        if (part.tool === 'question' && onAnswer) {
            return <QuestionToolDisplay part={part} onAnswer={onAnswer} />;
        }
        return (
            <ToolCallDisplay
                part={part}
                pendingPermission={pendingPermission}
                onPermissionRespond={onPermissionRespond}
                isRespondingToPermission={isRespondingToPermission}
            />
        );
    }

    if (isReasoningPart(part)) {
        return (
            <div className="reasoning-part">
                {part.text}
            </div>
        );
    }

    if (isFilePart(part)) {
        if (part.mime.startsWith('image/')) {
            return (
                <div className="file-part">
                    <img src={part.url} alt={part.filename || 'Image'} style={{ maxWidth: '100%' }} />
                </div>
            );
        }
        return (
            <div className="file-part">
                <a href={part.url} target="_blank" rel="noopener noreferrer">
                    {part.filename || 'Download file'}
                </a>
            </div>
        );
    }

    // For other part types (step-start, step-finish, agent), just skip rendering
    return null;
}

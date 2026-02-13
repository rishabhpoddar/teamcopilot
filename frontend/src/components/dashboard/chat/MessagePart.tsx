import type { Part } from '../../../types/chat';
import { isTextPart, isToolPart, isReasoningPart, isFilePart } from '../../../types/chat';
import ToolCallDisplay from './ToolCallDisplay';

interface MessagePartProps {
    part: Part;
}

export default function MessagePart({ part }: MessagePartProps) {
    if (isTextPart(part)) {
        // Simple markdown-like rendering for text
        const lines = part.text.split('\n');
        const elements: React.ReactNode[] = [];
        let inCodeBlock = false;
        let codeLines: string[] = [];
        let codeLanguage = '';

        lines.forEach((line, i) => {
            if (line.startsWith('```')) {
                if (inCodeBlock) {
                    // End code block
                    elements.push(
                        <pre key={`code-${i}`}>
                            <code className={codeLanguage ? `language-${codeLanguage}` : ''}>
                                {codeLines.join('\n')}
                            </code>
                        </pre>
                    );
                    codeLines = [];
                    inCodeBlock = false;
                } else {
                    // Start code block
                    codeLanguage = line.slice(3).trim();
                    inCodeBlock = true;
                }
            } else if (inCodeBlock) {
                codeLines.push(line);
            } else if (line.trim()) {
                // Regular paragraph
                elements.push(<p key={i}>{line}</p>);
            }
        });

        // Handle unclosed code block
        if (inCodeBlock && codeLines.length > 0) {
            elements.push(
                <pre key="code-final">
                    <code className={codeLanguage ? `language-${codeLanguage}` : ''}>
                        {codeLines.join('\n')}
                    </code>
                </pre>
            );
        }

        return <>{elements}</>;
    }

    if (isToolPart(part)) {
        return <ToolCallDisplay part={part} />;
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

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Part, PermissionRequest } from '../../../types/chat';
import { isTextPart, isToolPart, isReasoningPart } from '../../../types/chat';
import ToolCallDisplay from './ToolCallDisplay';
import QuestionToolDisplay from './QuestionToolDisplay';

interface MessagePartProps {
    part: Part;
    onAnswer: (answer: string) => void;
    pendingPermissions: PermissionRequest[];
    onPermissionRespond: (permissionId: string, response: "once" | "always" | "reject") => void;
    respondingPermissionIds: Record<string, boolean>;
}

type ReadToolTranscript = {
    path: string | null;
    file: string | null;
    content: string;
};

type DirectoryTranscript = {
    path: string;
    entries: string[];
    totalCount: number;
};

function stripToolCallNarration(text: string): string {
    const lines = text.split(/\r?\n/);
    const filteredReadLines = lines.filter((line) => {
        const trimmed = line.trim();
        return !(trimmed.startsWith('Called the Read tool with the following input:') && trimmed.includes('{"filePath"'));
    });
    const withoutReadNarration = filteredReadLines.join('\n');

    const hasRawContentTags = /<content>[\s\S]*<\/content>/i.test(text);
    const hasEscapedContentTags = /&lt;content&gt;[\s\S]*&lt;\/content&gt;/i.test(text);
    if (!hasRawContentTags && !hasEscapedContentTags) {
        return withoutReadNarration;
    }

    const filteredLines = filteredReadLines.filter((line) => {
        const trimmed = line.trim();
        return !(trimmed.startsWith('Called the ') && trimmed.includes(' tool with the following input:'));
    });
    return filteredLines.join('\n').trim();
}

function parseReadToolTranscript(text: string): ReadToolTranscript | null {
    const hasRawContentTags = /<content>[\s\S]*<\/content>/i.test(text);
    const hasEscapedContentTags = /&lt;content&gt;[\s\S]*&lt;\/content&gt;/i.test(text);
    if (!hasRawContentTags && !hasEscapedContentTags) {
        return null;
    }

    const normalizedText = text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

    const pathMatch = normalizedText.match(/<path>([\s\S]*?)<\/path>/i);
    const contentMatch = normalizedText.match(/<content>([\s\S]*?)<\/content>/i);
    const filenameMatch = text.match(/\n\n([^\n]+)\s*$/);

    if (!contentMatch) {
        return null;
    }

    const rawContent = contentMatch[1].trim();
    const contentWithLineBreaks = rawContent
        .replace(/\s+(?=\d+:\s)/g, '\n')
        .replace(/\r\n/g, '\n');

    return {
        path: pathMatch?.[1]?.trim() || null,
        file: filenameMatch?.[1] && filenameMatch[1] !== '</content>' ? filenameMatch[1].trim() : null,
        content: contentWithLineBreaks
    };
}

function parseDirectoryTranscript(text: string): { transcript: DirectoryTranscript; remainingText: string } | null {
    const normalizedText = text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

    // Check for directory type marker
    if (!/<type>\s*directory\s*<\/type>/i.test(normalizedText)) {
        return null;
    }

    const pathMatch = normalizedText.match(/<path>([\s\S]*?)<\/path>/i);
    const entriesMatch = normalizedText.match(/<entries>([\s\S]*?)<\/entries>/i);

    if (!pathMatch || !entriesMatch) {
        return null;
    }

    const path = pathMatch[1].trim();
    const entriesRaw = entriesMatch[1].trim();

    // Parse the count from "(N entries)" pattern
    const countMatch = entriesRaw.match(/\((\d+)\s+entr(?:y|ies)\)\s*$/i);
    const totalCount = countMatch ? parseInt(countMatch[1], 10) : 0;

    // Remove the count suffix and split by whitespace to get entries
    const entriesText = entriesRaw.replace(/\(\d+\s+entr(?:y|ies)\)\s*$/i, '').trim();
    const entries = entriesText.split(/\s+/).filter((e) => e.length > 0);

    // Extract the text before the directory block
    const fullBlockPattern = /<path>[\s\S]*?<\/path>\s*<type>\s*directory\s*<\/type>\s*<entries>[\s\S]*?<\/entries>/i;
    const remainingText = normalizedText.replace(fullBlockPattern, '').trim();

    return {
        transcript: {
            path,
            entries,
            totalCount: totalCount || entries.length
        },
        remainingText
    };
}

export default function MessagePart({
    part,
    onAnswer,
    pendingPermissions,
    onPermissionRespond,
    respondingPermissionIds
}: MessagePartProps) {
    if (isTextPart(part)) {
        const sanitizedText = stripToolCallNarration(part.text);
        if (!sanitizedText) {
            return null;
        }

        const readTranscript = parseReadToolTranscript(sanitizedText);
        if (readTranscript) {
            return (
                <div className="markdown-content">
                    {readTranscript.path && <p><strong>Path:</strong> <code>{readTranscript.path}</code></p>}
                    {readTranscript.file && <p><strong>File:</strong> <code>{readTranscript.file}</code></p>}
                    <details className="chat-read-content-details">
                        <summary>File contents</summary>
                        <pre className="chat-read-content-pre">{readTranscript.content}</pre>
                    </details>
                </div>
            );
        }

        const directoryResult = parseDirectoryTranscript(sanitizedText);
        if (directoryResult) {
            const { transcript: dirTranscript, remainingText } = directoryResult;
            return (
                <div className="markdown-content">
                    {remainingText && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {remainingText}
                        </ReactMarkdown>
                    )}
                    <div className="chat-directory-listing">
                        <p><strong>Directory:</strong> <code>{dirTranscript.path}</code></p>
                        <details className="chat-directory-details">
                            <summary>Contents ({dirTranscript.totalCount} {dirTranscript.totalCount === 1 ? 'entry' : 'entries'})</summary>
                            <ul className="chat-directory-entries">
                                {dirTranscript.entries.map((entry, idx) => (
                                    <li key={idx} className={entry.endsWith('/') ? 'is-directory' : 'is-file'}>
                                        <code>{entry}</code>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    </div>
                </div>
            );
        }

        return (
            <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {sanitizedText}
                </ReactMarkdown>
            </div>
        );
    }

    if (isToolPart(part)) {
        // Use special display for question tool
        if (part.tool === 'question') {
            return <QuestionToolDisplay part={part} onAnswer={onAnswer} />;
        }
        return (
            <ToolCallDisplay
                part={part}
                pendingPermissions={pendingPermissions}
                onPermissionRespond={onPermissionRespond}
                respondingPermissionIds={respondingPermissionIds}
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

    // For other part types (step-start, step-finish, agent), just skip rendering
    return null;
}

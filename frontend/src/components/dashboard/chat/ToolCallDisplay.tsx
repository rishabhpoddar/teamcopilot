import { useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import type { ToolPart, PermissionRequest } from '../../../types/chat';
import { useAuth } from '../../../lib/auth';
import { axiosInstance } from '../../../utils';
import PermissionPrompt from './PermissionPrompt';

interface ToolCallDisplayProps {
    part: ToolPart;
    pendingPermission: PermissionRequest | null;
    onPermissionRespond?: (response: "once" | "always" | "reject") => void;
    isRespondingToPermission: boolean;
}

type ToolDisplaySection = {
    key: string;
    content: string;
};

type DiffLine = {
    type: 'context' | 'removed' | 'added';
    text: string;
};

export default function ToolCallDisplay({
    part,
    pendingPermission,
    onPermissionRespond,
    isRespondingToPermission
}: ToolCallDisplayProps) {
    const auth = useAuth();
    const [expanded, setExpanded] = useState(false);
    const [logs, setLogs] = useState<string | null>(null);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [isLogsLoading, setIsLogsLoading] = useState(false);
    const fetchedFinalLogsRef = useRef(false);
    const logsContainerRef = useRef<HTMLPreElement | null>(null);
    const { state } = part;
    const token = auth.loading ? null : auth.token;
    const isRunWorkflowTool = part.tool === 'runWorkflow';
    const permissionMessageId = pendingPermission?.tool?.messageID;
    const permissionCallId = pendingPermission?.tool?.callID;
    const isPermissionForThisTool = Boolean(
        pendingPermission &&
        pendingPermission.sessionID === part.sessionID &&
        ((permissionCallId && permissionCallId === part.callID) ||
            (permissionMessageId && permissionMessageId === part.messageID))
    );

    useEffect(() => {
        setLogs(null);
        setLogsError(null);
        setIsLogsLoading(false);
        fetchedFinalLogsRef.current = false;
    }, [part.id, part.sessionID, part.messageID]);

    useEffect(() => {
        if (isRunWorkflowTool && state.status === 'running') {
            setExpanded(true);
        }
    }, [isRunWorkflowTool, state.status]);

    useEffect(() => {
        if (isPermissionForThisTool) {
            setExpanded(true);
        }
    }, [isPermissionForThisTool]);

    useEffect(() => {
        if (!expanded || !isRunWorkflowTool || !logsContainerRef.current) {
            return;
        }
        logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }, [logs, logsError, isLogsLoading, expanded, isRunWorkflowTool]);

    useEffect(() => {
        if (!isRunWorkflowTool || !token) {
            return;
        }

        let intervalId: number | undefined;
        let cancelled = false;

        const fetchLogs = async () => {
            try {
                setIsLogsLoading(true);
                const response = await axiosInstance.get(
                    `/api/chat/workflow-runs/${encodeURIComponent(part.sessionID)}/${encodeURIComponent(part.messageID)}/logs`,
                    {
                        headers: { Authorization: `Bearer ${token}` }
                    }
                );

                if (cancelled) {
                    return;
                }

                if (response.data?.found && typeof response.data.logs === 'string' && response.data.logs.length > 0) {
                    setLogs(response.data.logs);
                } else {
                    setLogs('<No logs available>');
                }
                setLogsError(null);
            } catch (err: unknown) {
                if (cancelled) {
                    return;
                }
                const errorMessage = err instanceof AxiosError
                    ? err.response?.data?.message || err.response?.data || err.message
                    : 'Failed to load workflow logs';
                setLogsError(String(errorMessage));
            } finally {
                if (!cancelled) {
                    setIsLogsLoading(false);
                }
            }
        };

        if (state.status === 'running') {
            void fetchLogs();
            intervalId = window.setInterval(() => {
                void fetchLogs();
            }, 500);
        } else if (state.status === 'completed' || state.status === 'error') {
            if (!fetchedFinalLogsRef.current) {
                fetchedFinalLogsRef.current = true;
                void fetchLogs();
            }
        }

        return () => {
            cancelled = true;
            if (intervalId) {
                window.clearInterval(intervalId);
            }
        };
    }, [isRunWorkflowTool, part.sessionID, part.messageID, state.status, token]);

    const getStatusLabel = () => {
        switch (state.status) {
            case 'pending':
                return 'Pending';
            case 'running':
                return state.title || 'Running...';
            case 'completed':
                return state.title || 'Completed';
            case 'error':
                return 'Error';
            default:
                return 'Unknown';
        }
    };

    const renderEscapedWhitespace = (value: string): string => {
        const escapedNewlineCount = (value.match(/\\n/g) || []).length;
        if (escapedNewlineCount < 2) {
            return value;
        }

        return value
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n');
    };

    const formatValueForDisplay = (value: unknown): string => {
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value) as unknown;
                if (parsed !== null && typeof parsed === 'object') {
                    return renderEscapedWhitespace(JSON.stringify(parsed, null, 2));
                }
            } catch {
                // Keep original string if it's not JSON
            }
            return renderEscapedWhitespace(value);
        }

        try {
            return renderEscapedWhitespace(JSON.stringify(value, null, 2));
        } catch {
            return renderEscapedWhitespace(String(value));
        }
    };

    const parseJsonIfString = (value: unknown): unknown => {
        if (typeof value !== 'string') {
            return value;
        }
        try {
            return JSON.parse(value) as unknown;
        } catch {
            return value;
        }
    };

    const parseXmlSections = (value: string): ToolDisplaySection[] | null => {
        const tagPattern = /<([A-Za-z0-9_-]+)>([\s\S]*?)<\/\1>/g;
        const sections: ToolDisplaySection[] = [];
        let match: RegExpExecArray | null;
        let consumed = '';

        while ((match = tagPattern.exec(value)) !== null) {
            const fullMatch = match[0];
            const key = match[1];
            const content = match[2];
            sections.push({
                key,
                content: formatValueForDisplay(content.trim())
            });
            consumed += fullMatch;
        }

        if (sections.length === 0) {
            return null;
        }

        const normalizedOriginal = value.replace(/\s+/g, '');
        const normalizedConsumed = consumed.replace(/\s+/g, '');
        if (normalizedOriginal !== normalizedConsumed) {
            return null;
        }

        return sections;
    };

    const toDisplaySections = (value: unknown): ToolDisplaySection[] | null => {
        if (typeof value === 'string') {
            const xmlSections = parseXmlSections(value);
            if (xmlSections) {
                return xmlSections;
            }
            return null;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            return null;
        }
        return entries.map(([key, sectionValue]) => ({
            key,
            content: formatValueForDisplay(sectionValue)
        }));
    };

    const findKeyCaseInsensitive = (obj: Record<string, unknown>, candidates: string[]): string | null => {
        const candidateSet = new Set(candidates.map((candidate) => candidate.toLowerCase()));
        for (const key of Object.keys(obj)) {
            if (candidateSet.has(key.toLowerCase())) {
                return key;
            }
        }
        return null;
    };

    const computeLineDiff = (oldText: string, newText: string): DiffLine[] => {
        const oldLines = oldText === '' ? [] : oldText.split('\n');
        const newLines = newText === '' ? [] : newText.split('\n');
        const oldLength = oldLines.length;
        const newLength = newLines.length;
        const lcs: number[][] = Array.from({ length: oldLength + 1 }, () => Array<number>(newLength + 1).fill(0));

        for (let i = oldLength - 1; i >= 0; i -= 1) {
            for (let j = newLength - 1; j >= 0; j -= 1) {
                if (oldLines[i] === newLines[j]) {
                    lcs[i][j] = lcs[i + 1][j + 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
                }
            }
        }

        const diff: DiffLine[] = [];
        let i = 0;
        let j = 0;

        while (i < oldLength && j < newLength) {
            if (oldLines[i] === newLines[j]) {
                diff.push({ type: 'context', text: oldLines[i] });
                i += 1;
                j += 1;
            } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
                diff.push({ type: 'removed', text: oldLines[i] });
                i += 1;
            } else {
                diff.push({ type: 'added', text: newLines[j] });
                j += 1;
            }
        }

        while (i < oldLength) {
            diff.push({ type: 'removed', text: oldLines[i] });
            i += 1;
        }

        while (j < newLength) {
            diff.push({ type: 'added', text: newLines[j] });
            j += 1;
        }

        return diff;
    };

    const getOutputValue = (): unknown | null => {
        if (state.status === 'completed') {
            if (isRunWorkflowTool) {
                try {
                    const parsed = JSON.parse(state.output) as unknown;
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        const sanitized = { ...(parsed as Record<string, unknown>) };
                        delete sanitized.output;

                        if (Object.keys(sanitized).length === 0) {
                            return null;
                        }

                        return sanitized;
                    }
                } catch {
                    // Keep original output if it's not JSON
                }
            }
            return state.output;
        }
        if (state.status === 'error') {
            return state.error;
        }
        return null;
    };

    const inputValue = parseJsonIfString(state.input);
    const inputSections = toDisplaySections(inputValue);
    const isEditTool = part.tool.toLowerCase() === 'edit';
    let editDiff: { oldKey: string; newKey: string; lines: DiffLine[] } | null = null;
    let remainingInputSections = inputSections;

    if (
        isEditTool &&
        inputValue &&
        typeof inputValue === 'object' &&
        !Array.isArray(inputValue)
    ) {
        const inputObject = inputValue as Record<string, unknown>;
        const oldKey = findKeyCaseInsensitive(inputObject, ['oldString', 'oldstring', 'old_text', 'oldText']);
        const newKey = findKeyCaseInsensitive(inputObject, ['newString', 'newstring', 'new_text', 'newText']);
        const oldValue = oldKey ? inputObject[oldKey] : null;
        const newValue = newKey ? inputObject[newKey] : null;

        if (oldKey && newKey && typeof oldValue === 'string' && typeof newValue === 'string') {
            editDiff = {
                oldKey,
                newKey,
                lines: computeLineDiff(renderEscapedWhitespace(oldValue), renderEscapedWhitespace(newValue))
            };
            if (inputSections) {
                const filteredSections = inputSections.filter(
                    (section) => section.key !== oldKey && section.key !== newKey
                );
                remainingInputSections = filteredSections.length > 0 ? filteredSections : null;
            }
        }
    }

    const outputValue = getOutputValue();
    const parsedOutputValue = outputValue === null ? null : parseJsonIfString(outputValue);
    const outputSections = parsedOutputValue === null ? null : toDisplaySections(parsedOutputValue);

    return (
        <div className="tool-call">
            <div
                className="tool-call-header"
                onClick={() => setExpanded(!expanded)}
            >
                <span>{expanded ? '▼' : '▶'}</span>
                <span className="tool-call-name">{part.tool}</span>
                <span className={`tool-call-status ${state.status}`}>
                    {getStatusLabel()}
                </span>
            </div>
            {expanded && (
                <div className="tool-call-body">
                    <div className="tool-call-input">
                        <div className="tool-call-label">Input</div>
                        {editDiff && (
                            <div className="tool-call-field">
                                <div className="tool-call-label">{editDiff.oldKey}{' -> '}{editDiff.newKey} (Diff)</div>
                                <div className="tool-call-content tool-call-diff-content">
                                    {editDiff.lines.length > 0 ? editDiff.lines.map((line, index) => {
                                        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                                        return (
                                            <div key={`${line.type}-${index}`} className={`tool-call-diff-line ${line.type}`}>
                                                {prefix} {line.text}
                                            </div>
                                        );
                                    }) : (
                                        <div className="tool-call-diff-line context">  (No changes)</div>
                                    )}
                                </div>
                            </div>
                        )}
                        {remainingInputSections ? (
                            <div className="tool-call-fields">
                                {remainingInputSections.map((section) => (
                                    <div key={section.key} className="tool-call-field">
                                        <div className="tool-call-label">{section.key}</div>
                                        <pre className="tool-call-content">{section.content}</pre>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <pre className="tool-call-content">{formatValueForDisplay(inputValue)}</pre>
                        )}
                    </div>
                    {parsedOutputValue !== null && (
                        <div className="tool-call-output">
                            <div className="tool-call-label">
                                {state.status === 'error' ? 'Error' : 'Output'}
                            </div>
                            {outputSections ? (
                                <div className="tool-call-fields">
                                    {outputSections.map((section) => (
                                        <div key={section.key} className="tool-call-field">
                                            <div className="tool-call-label">{section.key}</div>
                                            <pre className="tool-call-content">{section.content}</pre>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <pre className="tool-call-content">{formatValueForDisplay(parsedOutputValue)}</pre>
                            )}
                        </div>
                    )}
                    {isRunWorkflowTool && (
                        <div className="tool-call-output">
                            <div className="tool-call-label">Logs</div>
                            <pre ref={logsContainerRef} className="tool-call-content">
                                {logsError ? logsError : (isLogsLoading && !logs ? 'Loading logs...' : (logs ?? '<No logs available>'))}
                            </pre>
                        </div>
                    )}
                    {isPermissionForThisTool && onPermissionRespond && pendingPermission && (
                        <PermissionPrompt
                            permission={pendingPermission}
                            submitting={isRespondingToPermission}
                            onRespond={onPermissionRespond}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

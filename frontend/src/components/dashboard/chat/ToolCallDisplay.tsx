import { useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import type { ToolPart } from '../../../types/chat';
import { useAuth } from '../../../lib/auth';
import { axiosInstance } from '../../../utils';

interface ToolCallDisplayProps {
    part: ToolPart;
}

export default function ToolCallDisplay({ part }: ToolCallDisplayProps) {
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

    const formatInput = () => {
        try {
            return JSON.stringify(state.input, null, 2);
        } catch {
            return String(state.input);
        }
    };

    const formatOutput = () => {
        if (state.status === 'completed') {
            return state.output;
        }
        if (state.status === 'error') {
            return state.error;
        }
        return null;
    };

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
                        <pre className="tool-call-content">{formatInput()}</pre>
                    </div>
                    {formatOutput() && (
                        <div className="tool-call-output">
                            <div className="tool-call-label">
                                {state.status === 'error' ? 'Error' : 'Output'}
                            </div>
                            <pre className="tool-call-content">{formatOutput()}</pre>
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
                </div>
            )}
        </div>
    );
}

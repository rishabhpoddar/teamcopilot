import { useState } from 'react';
import type { ToolPart } from '../../../types/chat';

interface ToolCallDisplayProps {
    part: ToolPart;
}

export default function ToolCallDisplay({ part }: ToolCallDisplayProps) {
    const [expanded, setExpanded] = useState(false);
    const { state } = part;

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
                </div>
            )}
        </div>
    );
}

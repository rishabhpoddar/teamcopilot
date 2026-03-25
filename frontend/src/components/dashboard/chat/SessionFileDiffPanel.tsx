import type { ChatSessionDiffResponse } from '../../../types/chat';

interface SessionFileDiffPanelProps {
    diff: ChatSessionDiffResponse | null;
    loading: boolean;
    error: string | null;
    expandedPaths: string[];
    onSelectPath: (path: string) => void;
    onRefresh: () => void;
}

export default function SessionFileDiffPanel({
    diff,
    loading,
    error,
    expandedPaths,
    onSelectPath,
    onRefresh
}: SessionFileDiffPanelProps) {
    return (
        <section className="chat-session-diff-panel">
            <div className="chat-session-diff-header">
                <div>
                    <div className="chat-session-diff-title">Session File Diff</div>
                    <div className="chat-session-diff-summary">
                        {diff
                            ? `${diff.summary.added} added · ${diff.summary.modified} modified · ${diff.summary.deleted} deleted`
                            : 'Track files changed via apply_patch in this session'}
                    </div>
                </div>
                <button
                    type="button"
                    className="chat-session-diff-refresh"
                    onClick={onRefresh}
                    disabled={loading}
                >
                    {'Refresh'}
                </button>
            </div>

            <div className="chat-session-diff-warning">
                This diff is best-effort only. It may miss some file changes or show an incomplete view.
            </div>

            {error && <div className="chat-session-diff-state error">{error}</div>}
            {!error && loading && null}
            {!error && !loading && diff && diff.files.length === 0 && (
                <div className="chat-session-diff-state">No files changed via this AI session yet.</div>
            )}

            {!error && !loading && diff && diff.files.length > 0 && (
                <div className="chat-session-diff-body vertical">
                    {diff.files.map((file) => {
                        const isExpanded = expandedPaths.includes(file.path);
                        return (
                            <article key={`${file.status}:${file.path}`} className="chat-session-diff-file-card">
                                <button
                                    type="button"
                                    className={`chat-session-diff-file-item ${isExpanded ? 'active' : ''}`}
                                    onClick={() => onSelectPath(file.path)}
                                >
                                    <div className="chat-session-diff-file-item-main">
                                        <span className="chat-session-diff-file-chevron">{isExpanded ? '▾' : '▸'}</span>
                                        <span className="chat-session-diff-file-path">{file.path}</span>
                                    </div>
                                    <div className="chat-session-diff-viewer-meta">
                                        <span className={`chat-session-diff-file-badge ${file.status}`}>{file.status}</span>
                                        <span className="chat-session-diff-file-badge kind">{file.kind}</span>
                                    </div>
                                </button>

                                {isExpanded && (
                                    <div className="chat-session-diff-file-expanded">
                                        {file.message && (
                                            <div className="chat-session-diff-message">
                                                {file.message}
                                                {(file.old_size_bytes !== null || file.new_size_bytes !== null) && (
                                                    <span> ({file.old_size_bytes ?? 0}B → {file.new_size_bytes ?? 0}B)</span>
                                                )}
                                            </div>
                                        )}

                                        {file.patch_lines && (
                                            <div className="chat-session-diff-patch">
                                                {file.patch_lines.map((line, index) => {
                                                    const lineClass = line.startsWith('+')
                                                        ? 'added'
                                                        : line.startsWith('-')
                                                            ? 'removed'
                                                            : line.startsWith('@@')
                                                                ? 'hunk'
                                                                : 'context';
                                                    return (
                                                        <div key={`${file.path}-${index}`} className={`chat-session-diff-line ${lineClass}`}>
                                                            {line}
                                                        </div>
                                                    );
                                                })}
                                                {file.is_truncated && (
                                                    <div className="chat-session-diff-line truncated">... diff truncated ...</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

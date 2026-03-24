import type { ChatSessionDiffResponse } from '../../../types/chat';

interface SessionFileDiffPanelProps {
    diff: ChatSessionDiffResponse | null;
    loading: boolean;
    error: string | null;
    selectedPath: string | null;
    onSelectPath: (path: string) => void;
    onRefresh: () => void;
}

export default function SessionFileDiffPanel({
    diff,
    loading,
    error,
    selectedPath,
    onSelectPath,
    onRefresh
}: SessionFileDiffPanelProps) {
    const selectedFile = diff?.files.find((file) => file.path === selectedPath) ?? diff?.files[0] ?? null;

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
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {error && <div className="chat-session-diff-state error">{error}</div>}
            {!error && loading && <div className="chat-session-diff-state">Loading session diff...</div>}
            {!error && !loading && diff && diff.files.length === 0 && (
                <div className="chat-session-diff-state">No files changed via this AI session yet.</div>
            )}

            {!error && !loading && diff && diff.files.length > 0 && (
                <div className="chat-session-diff-body">
                    <div className="chat-session-diff-file-list">
                        {diff.files.map((file) => (
                            <button
                                key={`${file.status}:${file.path}`}
                                type="button"
                                className={`chat-session-diff-file-item ${selectedFile?.path === file.path ? 'active' : ''}`}
                                onClick={() => onSelectPath(file.path)}
                            >
                                <span className="chat-session-diff-file-path">{file.path}</span>
                                <span className={`chat-session-diff-file-badge ${file.status}`}>{file.status}</span>
                            </button>
                        ))}
                    </div>

                    <div className="chat-session-diff-viewer">
                        {selectedFile && (
                            <>
                                <div className="chat-session-diff-viewer-header">
                                    <div className="chat-session-diff-viewer-path">{selectedFile.path}</div>
                                    <div className="chat-session-diff-viewer-meta">
                                        <span className={`chat-session-diff-file-badge ${selectedFile.status}`}>{selectedFile.status}</span>
                                        <span className="chat-session-diff-file-badge kind">{selectedFile.kind}</span>
                                    </div>
                                </div>

                                {selectedFile.message && (
                                    <div className="chat-session-diff-message">
                                        {selectedFile.message}
                                        {(selectedFile.old_size_bytes !== null || selectedFile.new_size_bytes !== null) && (
                                            <span> ({selectedFile.old_size_bytes ?? 0}B → {selectedFile.new_size_bytes ?? 0}B)</span>
                                        )}
                                    </div>
                                )}

                                {selectedFile.patch_lines && (
                                    <div className="chat-session-diff-patch">
                                        {selectedFile.patch_lines.map((line, index) => {
                                            const lineClass = line.startsWith('+')
                                                ? 'added'
                                                : line.startsWith('-')
                                                    ? 'removed'
                                                    : line.startsWith('@@')
                                                        ? 'hunk'
                                                        : 'context';
                                            return (
                                                <div key={`${selectedFile.path}-${index}`} className={`chat-session-diff-line ${lineClass}`}>
                                                    {line}
                                                </div>
                                            );
                                        })}
                                        {selectedFile.is_truncated && (
                                            <div className="chat-session-diff-line truncated">... diff truncated ...</div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

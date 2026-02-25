import { AxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import type { WorkflowApprovalDiffResponse } from '../types/workflow';
import { useAuth } from '../lib/auth';
import { axiosInstance } from '../utils';
import './WorkflowApprovalReviewPage.css';

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

export default function WorkflowApprovalReviewPage() {
    const { slug = '' } = useParams();
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;

    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [diff, setDiff] = useState<WorkflowApprovalDiffResponse | null>(null);
    const [approved, setApproved] = useState(false);

    const loadDiff = async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const response = await axiosInstance.get(`/api/workflows/${encodeURIComponent(slug)}/approval-diff`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = typeof response.data === 'string'
                ? JSON.parse(response.data) as WorkflowApprovalDiffResponse
                : response.data as WorkflowApprovalDiffResponse;
            setDiff(data);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load approval diff'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!token) return;
        void loadDiff();
    }, [token, slug]);

    const handleApprove = async () => {
        if (!token) return;
        setApproving(true);
        try {
            await axiosInstance.post(`/api/workflows/${encodeURIComponent(slug)}/approve`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setApproved(true);
            toast.success('Workflow approved successfully');
            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.location.reload();
                } catch {
                    // no-op
                }
            }
            await loadDiff();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to approve workflow'));
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="approval-review-page">
            <header className="approval-review-header">
                <div>
                    <p className="approval-review-eyebrow">Approval Review</p>
                    <h1 className="approval-review-title">{slug}</h1>
                    <p className="approval-review-subtitle">
                        Review code changes against the last approved snapshot before approving.
                    </p>
                </div>
                <div className="approval-review-actions">
                    <button
                        type="button"
                        className="approval-review-btn secondary"
                        onClick={() => { void loadDiff(); }}
                        disabled={loading || approving}
                    >
                        {loading ? 'Refreshing...' : 'Refresh Diff'}
                    </button>
                    <button
                        type="button"
                        className="approval-review-btn primary"
                        onClick={() => { void handleApprove(); }}
                        disabled={loading || approving || diff === null}
                    >
                        {approving ? 'Approving...' : 'Approve Workflow'}
                    </button>
                </div>
            </header>

            {approved && (
                <div className="approval-review-banner success">
                    Workflow approved. You can close this tab.
                </div>
            )}

            {loading && <div className="approval-review-state">Loading diff...</div>}
            {error && <div className="approval-review-state error">{error}</div>}

            {!loading && !error && diff && (
                <>
                    <section className="approval-review-summary-card">
                        <div className="approval-review-summary-pills">
                            <span className="approval-review-pill added">+{diff.summary.added} added</span>
                            <span className="approval-review-pill modified">~{diff.summary.modified} modified</span>
                            <span className="approval-review-pill deleted">-{diff.summary.deleted} deleted</span>
                        </div>
                        <p className="approval-review-note">
                            {diff.has_previous_snapshot
                                ? 'Comparing current code to the previously approved snapshot.'
                                : 'No previous approved snapshot. All included files are shown as new.'}
                        </p>
                        {diff.ignored_rules.length > 0 && (
                            <p className="approval-review-note">
                                Ignored paths: {diff.ignored_rules.join('; ')}
                            </p>
                        )}
                    </section>

                    <section className="approval-review-files">
                        {diff.files.length === 0 ? (
                            <div className="approval-review-empty">No differences from the approved snapshot.</div>
                        ) : (
                            diff.files.map((file) => (
                                <article key={`${file.status}:${file.path}`} className="approval-review-file">
                                    <div className="approval-review-file-header">
                                        <div className="approval-review-file-path">{file.path}</div>
                                        <div className="approval-review-file-badges">
                                            <span className={`approval-review-file-badge ${file.status}`}>{file.status}</span>
                                            <span className="approval-review-file-badge kind">{file.kind}</span>
                                        </div>
                                    </div>

                                    {file.message && (
                                        <div className="approval-review-file-message">
                                            {file.message}
                                            {(file.old_size_bytes !== null || file.new_size_bytes !== null) && (
                                                <span> ({file.old_size_bytes ?? 0}B → {file.new_size_bytes ?? 0}B)</span>
                                            )}
                                        </div>
                                    )}

                                    {file.patch_lines && (
                                        <pre className="approval-review-patch">
                                            {file.patch_lines.map((line, index) => {
                                                const lineClass = line.startsWith('+')
                                                    ? 'added'
                                                    : line.startsWith('-')
                                                        ? 'removed'
                                                        : line.startsWith('@@')
                                                            ? 'hunk'
                                                            : 'context';
                                                return (
                                                    <div key={`${file.path}-${index}`} className={`approval-review-line ${lineClass}`}>
                                                        {line}
                                                    </div>
                                                );
                                            })}
                                            {file.is_truncated && (
                                                <div className="approval-review-line truncated">... diff truncated ...</div>
                                            )}
                                        </pre>
                                    )}
                                </article>
                            ))
                        )}
                    </section>
                </>
            )}
        </div>
    );
}


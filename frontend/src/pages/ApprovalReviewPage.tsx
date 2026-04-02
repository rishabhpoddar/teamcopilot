import { AxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import type { WorkflowApprovalDiffResponse } from '../types/workflow';
import { useAuth } from '../lib/auth';
import { summarizeDiffFiles } from '../utils/diffSummary';
import { axiosInstance } from '../utils';
import './WorkflowApprovalReviewPage.css';

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

type ApprovalEntity = 'workflow' | 'skill';

export default function ApprovalReviewPage({ entity = 'workflow' }: { entity?: ApprovalEntity }) {
    const { slug = '' } = useParams();
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const apiBase = entity === 'workflow' ? '/api/workflows' : '/api/skills';
    const entityLabel = entity === 'workflow' ? 'Workflow' : 'Skill';
    const entityLabelLower = entity === 'workflow' ? 'workflow' : 'skill';

    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [diff, setDiff] = useState<WorkflowApprovalDiffResponse | null>(null);
    const [approved, setApproved] = useState(false);
    const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

    const loadDiff = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const response = await axiosInstance.get(`${apiBase}/${encodeURIComponent(slug)}/approval-diff`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = typeof response.data === 'string'
                ? JSON.parse(response.data) as WorkflowApprovalDiffResponse
                : response.data as WorkflowApprovalDiffResponse;
            setDiff(data);
            setCollapsedFiles({});
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load approval diff'));
        } finally {
            setLoading(false);
        }
    }, [apiBase, slug, token]);

    useEffect(() => {
        void loadDiff();
    }, [loadDiff]);

    const handleApprove = async () => {
        if (!token) return;
        setApproving(true);
        try {
            await axiosInstance.post(`${apiBase}/${encodeURIComponent(slug)}/approve`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setApproved(true);
            toast.success(`${entityLabel} approved successfully`);
            await loadDiff();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, `Failed to approve ${entityLabelLower}`));
        } finally {
            setApproving(false);
        }
    };

    const handleRejectAndRestore = async () => {
        if (!token || !diff || !diff.has_previous_snapshot) return;
        setRejecting(true);
        try {
            await axiosInstance.post(`${apiBase}/${encodeURIComponent(slug)}/reject-restore`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setApproved(false);
            toast.success(`${entityLabel} files restored to last approved snapshot`);
            await loadDiff();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to restore files from approved snapshot'));
        } finally {
            setRejecting(false);
        }
    };

    const toggleFileCollapsed = (fileKey: string) => {
        setCollapsedFiles((prev) => ({
            ...prev,
            [fileKey]: !prev[fileKey]
        }));
    };

    const hasVisibleChanges = diff !== null && diff.files.length > 0;
    const visibleSummary = diff ? summarizeDiffFiles(diff.files) : null;

    return (
        <div className="approval-review-page">
            <header className="approval-review-header">
                <div>
                    <p className="approval-review-eyebrow">Approval Review</p>
                    <h1 className="approval-review-title">{slug}</h1>
                    <p className="approval-review-subtitle">
                        Review {entityLabelLower} changes against the last approved snapshot before approving.
                    </p>
                </div>
                <div className="approval-review-actions">
                    <button
                        type="button"
                        className="approval-review-btn secondary"
                        onClick={() => { void loadDiff(); }}
                        disabled={loading || approving || rejecting}
                    >
                        {loading ? 'Refreshing...' : 'Refresh Diff'}
                    </button>
                    {hasVisibleChanges && diff?.has_previous_snapshot && (
                        <button
                            type="button"
                            className="approval-review-btn danger"
                            onClick={() => { void handleRejectAndRestore(); }}
                            disabled={loading || approving || rejecting}
                        >
                            {rejecting ? 'Restoring...' : 'Reject & Restore'}
                        </button>
                    )}
                    {hasVisibleChanges && (
                        <button
                            type="button"
                            className="approval-review-btn primary"
                            onClick={() => { void handleApprove(); }}
                            disabled={loading || approving || rejecting || diff === null}
                        >
                            {approving ? 'Approving...' : `Approve ${entityLabel}`}
                        </button>
                    )}
                </div>
            </header>

            {approved && (
                <div className="approval-review-banner success">
                    {entityLabel} approved. You can close this tab.
                </div>
            )}

            {loading && <div className="approval-review-state">Loading diff...</div>}
            {error && <div className="approval-review-state error">{error}</div>}

            {!loading && !error && diff && (
                <>
                    <section className="approval-review-summary-card">
                        <div className="approval-review-summary-pills">
                            <span className="approval-review-pill added">+{visibleSummary?.added ?? 0} added</span>
                            <span className="approval-review-pill modified">~{visibleSummary?.modified ?? 0} modified</span>
                            <span className="approval-review-pill deleted">-{visibleSummary?.deleted ?? 0} deleted</span>
                        </div>
                        <p className="approval-review-note">
                            {diff.has_previous_snapshot
                                ? 'Comparing current code to the previously approved snapshot.'
                                : 'No previous approved snapshot. All included files are shown as new.'}
                        </p>
                    </section>

                    <section className="approval-review-files">
                        {diff.files.length === 0 ? (
                            <div className="approval-review-empty">No differences from the approved snapshot.</div>
                        ) : (
                            diff.files.map((file) => (
                                (() => {
                                    const fileKey = `${file.status}:${file.path}`;
                                    const isCollapsed = collapsedFiles[fileKey] === true;
                                    return (
                                        <article key={fileKey} className="approval-review-file">
                                            <button
                                                type="button"
                                                className="approval-review-file-header approval-review-file-toggle"
                                                onClick={() => toggleFileCollapsed(fileKey)}
                                                aria-expanded={!isCollapsed}
                                                aria-controls={`approval-diff-file-${encodeURIComponent(fileKey)}`}
                                            >
                                                <div className="approval-review-file-header-main">
                                                    <span className="approval-review-file-chevron">{isCollapsed ? '▸' : '▾'}</span>
                                                    <div className="approval-review-file-path">{file.path}</div>
                                                </div>
                                                <div className="approval-review-file-badges">
                                                    <span className="approval-review-file-badge collapse-label">
                                                        {isCollapsed ? 'collapsed' : 'expanded'}
                                                    </span>
                                                    <span className={`approval-review-file-badge ${file.status}`}>{file.status}</span>
                                                    <span className="approval-review-file-badge kind">{file.kind}</span>
                                                </div>
                                            </button>

                                            {!isCollapsed && (
                                                <div id={`approval-diff-file-${encodeURIComponent(fileKey)}`}>
                                                    {file.message && (
                                                        <div className="approval-review-file-message">
                                                            {file.message}
                                                            {(file.old_size_bytes !== null || file.new_size_bytes !== null) && (
                                                                <span> ({file.old_size_bytes ?? 0}B → {file.new_size_bytes ?? 0}B)</span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {file.patch_lines && (
                                                        <div className="approval-review-patch-scroll">
                                                            <div className="approval-review-patch">
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
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </article>
                                    );
                                })()
                            ))
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import ChatContainer from '../components/dashboard/chat/ChatContainer';
import type { ChatSession } from '../types/chat';
import './CronjobRunPage.css';

interface CronjobRun {
    id: string;
    cronjob_id: string;
    status: string;
    started_at: number;
    completed_at: number | null;
    target_type_snapshot: string;
    prompt_snapshot: string | null;
    workflow_slug_snapshot: string | null;
    workflow_input_snapshot: Record<string, unknown> | null;
    workflow_run_id: string | null;
    summary: string | null;
    session_id: string | null;
    opencode_session_id: string | null;
    error_message: string | null;
}

function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof AxiosError) {
        const responseData = err.response?.data;
        if (typeof responseData?.message === 'string') return responseData.message;
        if (typeof responseData === 'string') return responseData;
        return err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
}

function formatTimestamp(value: number | null): string {
    if (value === null) return 'Still running';
    return new Date(value).toLocaleString();
}

function statusLabel(status: string): string {
    return status.replaceAll('_', ' ');
}

export default function CronjobRunPage() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const navigate = useNavigate();
    const params = useParams();
    const runId = params.id as string;
    const [run, setRun] = useState<CronjobRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);

    usePageTitle('Cronjob Run');

    const loadRun = useCallback(async (options?: { showLoading?: boolean }) => {
        if (!token) return;
        try {
            if (options?.showLoading !== false) {
                setLoading(true);
            }
            const response = await axiosInstance.get(`/api/cronjobs/runs/${runId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setRun(response.data.run);
            setError(null);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load cronjob run'));
        } finally {
            if (options?.showLoading !== false) {
                setLoading(false);
            }
        }
    }, [runId, token]);

    useEffect(() => {
        loadRun();
    }, [loadRun]);

    useEffect(() => {
        if (!run || run.status !== 'running') {
            return;
        }
        const intervalId = window.setInterval(() => {
            void loadRun({ showLoading: false });
        }, 2000);
        return () => window.clearInterval(intervalId);
    }, [loadRun, run]);

    const fixedSession = useMemo<ChatSession | null>(() => {
        if (!run?.session_id || !run.opencode_session_id) {
            return null;
        }
        return {
            id: run.session_id,
            opencode_session_id: run.opencode_session_id,
            title: `Cronjob run ${run.id.slice(0, 8)}`,
            created_at: run.started_at,
            updated_at: run.completed_at ?? Date.now(),
            state: run.status === 'running' ? 'processing' : 'idle',
            latest_message_id: null,
        };
    }, [run]);

    const stopRun = async () => {
        if (!token || !run || run.status !== 'running') return;
        setStopping(true);
        try {
            await axiosInstance.post(`/api/cronjobs/runs/${run.id}/stop`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Cronjob run stopped');
            await loadRun({ showLoading: false });
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to stop cronjob run'));
        } finally {
            setStopping(false);
        }
    };

    if (auth.loading || loading) {
        return <div className="cronjob-run-state">Loading cronjob run...</div>;
    }

    if (error || !run) {
        return <div className="cronjob-run-state error">{error ?? 'Cronjob run not found'}</div>;
    }

    return (
        <main className="cronjob-run-page">
            <div className="cronjob-run-topbar">
                <button onClick={() => navigate('/?tab=cronjobs')}>Back to cronjobs</button>
                <button onClick={() => navigate(`/cronjobs/${run.cronjob_id}/edit`)}>Edit cronjob</button>
            </div>

            <section className="cronjob-run-header">
                <div>
                    <p className="cronjobs-eyebrow">{run.target_type_snapshot === 'workflow' ? 'Workflow cronjob run' : 'Cronjob transcript'}</p>
                    <h1>Run {run.id.slice(0, 8)}</h1>
                    <p>
                        {run.target_type_snapshot === 'workflow'
                            ? 'This scheduled workflow run executes directly with the saved inputs.'
                            : 'Watch live agent messages while running, or review the same transcript after completion.'}
                    </p>
                </div>
                <div className="cronjob-run-status-card">
                    <span>Status</span>
                    <strong>{statusLabel(run.status)}</strong>
                    {run.status === 'running' && (
                        <button className="cronjob-run-stop-btn" onClick={stopRun} disabled={stopping}>
                            {stopping ? 'Stopping...' : 'Stop run'}
                        </button>
                    )}
                </div>
            </section>

            <section className="cronjob-run-meta">
                <div>
                    <span>Target</span>
                    <strong>
                        {run.target_type_snapshot === 'workflow'
                            ? `Workflow: ${run.workflow_slug_snapshot}`
                            : 'Prompt'}
                    </strong>
                </div>
                {run.workflow_run_id && (
                    <div>
                        <span>Workflow run</span>
                        <strong>{run.workflow_run_id.slice(0, 8)}</strong>
                    </div>
                )}
                <div>
                    <span>Started</span>
                    <strong>{formatTimestamp(run.started_at)}</strong>
                </div>
                <div>
                    <span>Completed</span>
                    <strong>{formatTimestamp(run.completed_at)}</strong>
                </div>
                {run.summary && (
                    <div className="cronjob-run-meta-wide">
                        <span>Summary</span>
                        <strong>{run.summary}</strong>
                    </div>
                )}
                {run.error_message && (
                    <div className="cronjob-run-meta-wide">
                        <span>Error</span>
                        <strong>{run.error_message}</strong>
                    </div>
                )}
            </section>

            {fixedSession ? (
                <ChatContainer
                    initialDraftMessage={null}
                    forceNewChat={false}
                    onDraftHandled={() => {}}
                    fixedSession={fixedSession}
                    readOnly
                />
            ) : (
                <div className="cronjob-run-state">
                    {run.target_type_snapshot === 'workflow'
                        ? 'This workflow cronjob does not have an agent chat transcript. Open the linked workflow run from workflow history for detailed logs.'
                        : 'This run does not have an agent session transcript.'}
                </div>
            )}
        </main>
    );
}

import { AxiosError } from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { WorkflowRun } from '../types/workflow';
import { axiosInstance } from '../utils';
import './RunDetailsPage.css';

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

function formatDate(timestamp: number | null): string {
    if (!timestamp) return 'Not completed';
    return new Date(timestamp).toLocaleString();
}

function formatDuration(startedAt: number, completedAt: number | null): string {
    if (!completedAt) return 'Running...';
    const durationMs = completedAt - startedAt;
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
}

function parseArgs(args: string | null): string {
    if (!args) {
        return 'No input provided';
    }

    try {
        const parsed = JSON.parse(args) as unknown;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return args;
    }
}

export default function RunDetailsPage() {
    const { id = '' } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [run, setRun] = useState<WorkflowRun | null>(null);
    const [logs, setLogs] = useState<string>('No logs captured.');
    const [stopping, setStopping] = useState(false);
    const runStatusRef = useRef<WorkflowRun['status'] | null>(null);

    const authHeader = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

    useEffect(() => {
        runStatusRef.current = run?.status ?? null;
    }, [run]);

    useEffect(() => {
        if (!authHeader) return;
        let cancelled = false;

        const fetchRunAndLogs = async (showLoading: boolean) => {
            if (showLoading) {
                setLoading(true);
            }
            try {
                const [runResponse, logsResponse] = await Promise.all([
                    axiosInstance.get(`/api/workflows/runs/${encodeURIComponent(id)}`, {
                        headers: authHeader
                    }),
                    axiosInstance.get(`/api/workflows/runs/logs?run_id=${encodeURIComponent(id)}`, {
                        headers: authHeader
                    })
                ]);

                if (!cancelled) {
                    const nextRun = runResponse.data.run as WorkflowRun;
                    setRun(nextRun);
                    if (logsResponse.data?.found && typeof logsResponse.data.logs === 'string') {
                        setLogs(logsResponse.data.logs);
                    } else {
                        setLogs(nextRun.output || 'No logs captured.');
                    }
                    setError(null);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(getErrorMessage(err, 'Failed to load run details'));
                }
            } finally {
                if (!cancelled && showLoading) {
                    setLoading(false);
                }
            }
        };

        void fetchRunAndLogs(true);

        const intervalId = window.setInterval(() => {
            if (cancelled) return;
            if (runStatusRef.current && runStatusRef.current !== 'running') {
                return;
            }
            void fetchRunAndLogs(false);
        }, 1000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [authHeader, id]);

    if (auth.loading) return null;

    const handleStopRun = async () => {
        if (!authHeader || !run || run.status !== 'running') return;
        setStopping(true);
        try {
            await axiosInstance.post(`/api/workflows/runs/${encodeURIComponent(id)}/stop`, {}, {
                headers: authHeader
            });
            toast.info('Stop requested');
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to stop workflow run'));
        } finally {
            setStopping(false);
        }
    };

    return (
        <div className="run-details-page">
            <header className="run-details-header">
                <button className="run-details-back-btn" onClick={() => navigate('/?tab=history')}>
                    Back to Run History
                </button>
                <h1>Run Details</h1>
            </header>

            {loading && <div className="run-details-state">Loading run details...</div>}
            {error && <div className="run-details-state error">{error}</div>}

            {!loading && !error && run && (
                <div className="run-details-content">
                    <section className="run-details-card">
                        <div className="run-details-title-row">
                            <h2>{run.workflow_slug}</h2>
                            <div className="run-details-title-actions">
                                {run.status === 'running' && (
                                    <button
                                        type="button"
                                        className="run-details-stop-btn"
                                        onClick={() => {
                                            void handleStopRun();
                                        }}
                                        disabled={stopping}
                                    >
                                        {stopping ? 'Stopping...' : 'Stop'}
                                    </button>
                                )}
                                <span className={`run-details-status status-${run.status}`}>{run.status}</span>
                            </div>
                        </div>
                        <div className="run-details-grid">
                            <div>
                                <p className="run-details-label">Ran by</p>
                                <p>{run.user.name} ({run.user.email})</p>
                            </div>
                            <div>
                                <p className="run-details-label">Started</p>
                                <p>{formatDate(run.started_at)}</p>
                            </div>
                            <div>
                                <p className="run-details-label">Completed</p>
                                <p>{formatDate(run.completed_at)}</p>
                            </div>
                            <div>
                                <p className="run-details-label">Duration</p>
                                <p>{formatDuration(run.started_at, run.completed_at)}</p>
                            </div>
                        </div>
                    </section>

                    <section className="run-details-card">
                        <h3>Input</h3>
                        <pre>{parseArgs(run.args)}</pre>
                    </section>

                    <section className="run-details-card">
                        <h3>Logs</h3>
                        <pre>{logs || 'No logs captured.'}</pre>
                    </section>
                </div>
            )}
        </div>
    );
}

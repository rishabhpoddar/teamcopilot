import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import { cronjobRunSummaryText } from '../../utils/cronjob-format';
import './WorkflowsSection.css';
import './CronjobsSection.css';

interface CronjobSchedule {
    cron_expression: string;
    timezone: string;
    effective_cron_expression: string;
}

interface CronjobRunPreview {
    id: string;
    status: string;
    started_at: number;
    completed_at: number | null;
    target_type_snapshot: string;
    workflow_run_id: string | null;
}

interface CronjobRun {
    id: string;
    status: string;
    started_at: number;
    target_type_snapshot: string;
    workflow_run_id: string | null;
    summary: string | null;
    error_message: string | null;
}

interface Cronjob {
    id: string;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    monitor_timeout_value: number;
    monitor_timeout_unit: 'minutes' | 'hours' | 'days';
    target: {
        target_type: 'prompt' | 'workflow';
        prompt: string | null;
        prompt_allow_workflow_runs_without_permission: boolean | null;
        workflow_slug: string | null;
        workflow_inputs: Record<string, unknown> | null;
    };
    schedule: CronjobSchedule;
    next_run_at: number | null;
    is_running: boolean;
    current_run_id: string | null;
    current_workflow_run_id: string | null;
    latest_run: CronjobRunPreview | null;
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

function ordinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) {
        return 'th';
    }
    const lastDigit = day % 10;
    if (lastDigit === 1) return 'st';
    if (lastDigit === 2) return 'nd';
    if (lastDigit === 3) return 'rd';
    return 'th';
}

function formatTimestamp(value: number | null): string {
    if (value === null) return 'Not scheduled';
    const date = new Date(value);
    const day = date.getDate();
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date);
    const year = date.getFullYear();
    return `${day}${ordinalSuffix(day)} ${month}, ${year}`;
}

function targetLabel(cronjob: Cronjob): string {
    if (cronjob.target.target_type === 'workflow') {
        return `Workflow: ${cronjob.target.workflow_slug}`;
    }
    return 'Prompt';
}

function formatMonitorTimeout(value: number, unit: Cronjob['monitor_timeout_unit']): string {
    const label = value === 1 ? unit.slice(0, -1) : unit;
    return `${value} ${label}`;
}

function statusLabel(status: string): string {
    return status.replaceAll('_', ' ');
}

function getRunStatusClass(status: string): string {
    if (status === 'success') return 'success';
    if (status === 'running') return 'running';
    if (status === 'failed') return 'failed';
    return 'muted';
}

function activeRunPath(cronjob: Cronjob): string | null {
    if (cronjob.current_workflow_run_id) {
        return `/runs/${cronjob.current_workflow_run_id}`;
    }
    if (cronjob.current_run_id) {
        return `/cronjobs/runs/${cronjob.current_run_id}`;
    }
    return null;
}

function pastRunPath(run: CronjobRun): string {
    return run.target_type_snapshot === 'workflow' && run.workflow_run_id
        ? `/runs/${run.workflow_run_id}`
        : `/cronjobs/runs/${run.id}`;
}

export default function CronjobsSection() {
    const auth = useAuth();
    const navigate = useNavigate();
    const token = auth.loading ? null : auth.token;
    const [cronjobs, setCronjobs] = useState<Cronjob[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runsByCronjob, setRunsByCronjob] = useState<Record<string, CronjobRun[]>>({});
    const [activeRunsCronjob, setActiveRunsCronjob] = useState<Cronjob | null>(null);
    const [startingCronjobId, setStartingCronjobId] = useState<string | null>(null);
    const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);

    const fetchCronjobs = useCallback(async () => {
        if (!token) return;
        try {
            const response = await axiosInstance.get('/api/cronjobs', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setCronjobs(response.data.cronjobs);
            setError(null);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load cronjobs'));
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchCronjobs();
    }, [fetchCronjobs]);

    if (auth.loading) return null;

    const toggleEnabled = async (cronjob: Cronjob) => {
        if (!token) return;
        try {
            await axiosInstance.post(`/api/cronjobs/${cronjob.id}/${cronjob.enabled ? 'disable' : 'enable'}`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            await fetchCronjobs();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to update cronjob status'));
        }
    };

    const runNow = async (cronjob: Cronjob) => {
        if (!token || cronjob.is_running || startingCronjobId) return;
        setStartingCronjobId(cronjob.id);
        try {
            const response = await axiosInstance.post(`/api/cronjobs/${cronjob.id}/run-now`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Cronjob run started');
            await fetchCronjobs();
            const runId = String(response.data.run_id);
            const workflowRunId = response.data.workflow_run_id ? String(response.data.workflow_run_id) : null;
            navigate(workflowRunId ? `/runs/${workflowRunId}` : `/cronjobs/runs/${runId}`);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to start cronjob'));
        } finally {
            setStartingCronjobId(null);
        }
    };

    const terminateRun = async (runId: string) => {
        if (!token || stoppingRunId) return;
        setStoppingRunId(runId);
        try {
            await axiosInstance.post(`/api/cronjobs/runs/${runId}/terminate`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Cronjob run terminated');
            await fetchCronjobs();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to terminate cronjob run'));
        } finally {
            setStoppingRunId(null);
        }
    };

    const deleteCronjob = async (cronjob: Cronjob) => {
        if (!token) return;
        const confirmed = window.confirm(`Delete cronjob "${cronjob.name}"? Past run history will also be deleted.`);
        if (!confirmed) return;
        try {
            await axiosInstance.delete(`/api/cronjobs/${cronjob.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Cronjob deleted');
            await fetchCronjobs();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to delete cronjob'));
        }
    };

    const openPastRuns = async (cronjob: Cronjob) => {
        if (!token) return;
        try {
            const response = await axiosInstance.get(`/api/cronjobs/${cronjob.id}/runs`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setRunsByCronjob((prev) => ({ ...prev, [cronjob.id]: response.data.runs }));
            setActiveRunsCronjob(cronjob);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to load cronjob runs'));
        }
    };

    const closePastRuns = () => {
        setActiveRunsCronjob(null);
    };

    const activeRuns = activeRunsCronjob ? (runsByCronjob[activeRunsCronjob.id] ?? []) : [];

    if (loading) {
        return <div className="section-loading">Loading cronjobs...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    return (
        <div className="cronjobs-section-content">
            <section className="cronjobs-hero">
                <div>
                    <p className="cronjobs-eyebrow">Scheduled agents</p>
                    <h2>Cronjobs</h2>
                    <p>
                        Run recurring jobs for background task completion.
                    </p>
                </div>
                <button className="cronjobs-primary-btn" onClick={() => navigate('/cronjobs/new')}>
                    Create Cronjob
                </button>
            </section>

            {cronjobs.length === 0 ? (
                <div className="cronjobs-empty-state">
                    <div className="cronjobs-empty-orb" />
                    <h3>No Cronjobs Yet</h3>
                    <p></p>
                    <button className="cronjobs-primary-btn" onClick={() => navigate('/cronjobs/new')}>
                        Create your first cronjob
                    </button>
                </div>
            ) : (
                <div className="cronjobs-grid">
                    {cronjobs.map((cronjob) => (
                        <article className="cronjob-card" key={cronjob.id}>
                            <div className="cronjob-card-topline">
                                <span className={`cronjob-status-badge ${cronjob.enabled ? 'enabled' : 'disabled'}`}>
                                    {cronjob.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                                {cronjob.is_running && <span className="cronjob-live-pill">Active run</span>}
                            </div>

                            <div className="cronjob-card-header">
                                <h3>{cronjob.name}</h3>
                                <p>{cronjob.target.target_type === 'workflow' ? targetLabel(cronjob) : cronjob.prompt}</p>
                            </div>

                            <div className="cronjob-metrics">
                                <div>
                                    <span>Next run</span>
                                    <strong>{formatTimestamp(cronjob.next_run_at)}</strong>
                                </div>
                                <div>
                                    <span>Job timeout</span>
                                    <strong>{formatMonitorTimeout(cronjob.monitor_timeout_value, cronjob.monitor_timeout_unit)}</strong>
                                </div>
                            </div>

                            <div className="cronjob-run-summary">
                                <span className={`cronjob-run-dot ${cronjob.latest_run ? getRunStatusClass(cronjob.latest_run.status) : 'muted'}`} />
                                <div>
                                    <span>Latest run</span>
                                    <strong>
                                        {cronjob.latest_run
                                            ? `${statusLabel(cronjob.latest_run.status)} at ${formatTimestamp(cronjob.latest_run.started_at)}`
                                            : 'Never run'}
                                    </strong>
                                </div>
                            </div>

                            {cronjob.target.target_type === 'prompt' ? (
                                <p className="cronjob-permission-copy">
                                    Workflows: {cronjob.allow_workflow_runs_without_permission ? 'run without extra user approval' : 'ask before running'}
                                </p>
                            ) : (
                                <p className="cronjob-permission-copy">
                                    Workflow cronjob: runs directly with saved inputs.
                                </p>
                            )}

                            <div className="cronjob-actions">
                                <button
                                    className="cronjobs-primary-btn compact"
                                    disabled={cronjob.is_running || startingCronjobId !== null}
                                    onClick={() => runNow(cronjob)}
                                >
                                    {startingCronjobId === cronjob.id ? 'Starting...' : cronjob.is_running ? 'Already active' : 'Run now'}
                                </button>
                                {cronjob.current_run_id && (
                                    <>
                                        <button onClick={() => {
                                            const path = activeRunPath(cronjob);
                                            if (path) navigate(path);
                                        }}>
                                            Monitor
                                        </button>
                                        <button
                                            className="cronjob-danger-btn"
                                            disabled={stoppingRunId !== null}
                                            onClick={() => terminateRun(cronjob.current_run_id!)}
                                        >
                                            {stoppingRunId === cronjob.current_run_id ? 'Terminating...' : 'Terminate'}
                                        </button>
                                    </>
                                )}
                                <button onClick={() => toggleEnabled(cronjob)}>
                                    {cronjob.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button onClick={() => navigate(`/cronjobs/${cronjob.id}/edit`)}>
                                    Edit
                                </button>
                                <button onClick={() => void openPastRuns(cronjob)}>
                                    View past runs
                                </button>
                                <button className="cronjob-danger-btn" onClick={() => deleteCronjob(cronjob)}>
                                    Delete
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            )}

            {activeRunsCronjob && (
                <div className="cronjob-runs-modal-backdrop" onClick={closePastRuns}>
                    <div className="cronjob-runs-modal" onClick={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            className="cronjob-runs-modal-close"
                            aria-label="Close"
                            onClick={closePastRuns}
                        />
                        <div className="cronjob-runs-modal-header">
                            <div>
                                <p className="cronjobs-eyebrow">Past runs</p>
                                <h3>{activeRunsCronjob.name}</h3>
                            </div>
                        </div>
                        <div className="cronjob-runs-modal-list">
                            {activeRuns.length === 0 ? (
                                <p className="workflow-card-meta">No runs yet.</p>
                            ) : (
                                activeRuns.map((run) => (
                                    <button
                                        type="button"
                                        className="cronjob-run-row"
                                        key={run.id}
                                        onClick={() => navigate(pastRunPath(run))}
                                    >
                                        <div>
                                            <strong>{statusLabel(run.status)}</strong>
                                            <span>{formatTimestamp(run.started_at)}</span>
                                        </div>
                                        <p>{cronjobRunSummaryText(run.summary)}</p>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

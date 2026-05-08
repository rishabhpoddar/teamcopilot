import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import './WorkflowsSection.css';
import './CronjobsSection.css';

type ScheduleMode = 'preset' | 'cron';

interface CronjobSchedule {
    preset_key: string | null;
    cron_expression: string | null;
    timezone: string;
    effective_cron_expression: string;
}

interface CronjobRun {
    id: string;
    cronjob_id: string;
    status: string;
    started_at: number;
    completed_at: number | null;
    prompt_snapshot: string;
    summary: string | null;
    session_id: string | null;
    opencode_session_id: string | null;
    needs_user_input_reason: string | null;
    error_message: string | null;
}

interface Cronjob {
    id: string;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    created_at: number;
    updated_at: number;
    schedule: CronjobSchedule;
    next_run_at: number | null;
    latest_run: Pick<CronjobRun, 'id' | 'status' | 'started_at' | 'completed_at'> | null;
}

interface CronjobFormState {
    id: string | null;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    scheduleMode: ScheduleMode;
    preset_key: string;
    cron_expression: string;
    timezone: string;
}

const PRESETS: Array<{ key: string; label: string }> = [
    { key: 'hourly', label: 'Hourly' },
    { key: 'daily', label: 'Daily at 9:00' },
    { key: 'weekdays', label: 'Weekdays at 9:00' },
    { key: 'weekly', label: 'Weekly on Monday at 9:00' },
];

function getLocalTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function emptyForm(): CronjobFormState {
    return {
        id: null,
        name: '',
        prompt: '',
        enabled: true,
        allow_workflow_runs_without_permission: true,
        scheduleMode: 'preset',
        preset_key: 'daily',
        cron_expression: '0 9 * * *',
        timezone: getLocalTimezone(),
    };
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
    if (value === null) return 'Not scheduled';
    return new Date(value).toLocaleString();
}

function scheduleLabel(cronjob: Cronjob): string {
    if (cronjob.schedule.preset_key) {
        const preset = PRESETS.find((candidate) => candidate.key === cronjob.schedule.preset_key);
        return preset ? preset.label : cronjob.schedule.preset_key;
    }
    return cronjob.schedule.cron_expression ?? cronjob.schedule.effective_cron_expression;
}

function statusLabel(status: string): string {
    return status.replaceAll('_', ' ');
}

export default function CronjobsSection() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const [cronjobs, setCronjobs] = useState<Cronjob[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<CronjobFormState>(() => emptyForm());
    const [runsByCronjob, setRunsByCronjob] = useState<Record<string, CronjobRun[]>>({});
    const [expandedCronjobId, setExpandedCronjobId] = useState<string | null>(null);

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

    const startEdit = (cronjob: Cronjob) => {
        setForm({
            id: cronjob.id,
            name: cronjob.name,
            prompt: cronjob.prompt,
            enabled: cronjob.enabled,
            allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
            scheduleMode: cronjob.schedule.preset_key ? 'preset' : 'cron',
            preset_key: cronjob.schedule.preset_key ?? 'daily',
            cron_expression: cronjob.schedule.cron_expression ?? cronjob.schedule.effective_cron_expression,
            timezone: cronjob.schedule.timezone,
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setForm(emptyForm());
    };

    const buildPayload = () => ({
        name: form.name,
        prompt: form.prompt,
        enabled: form.enabled,
        allow_workflow_runs_without_permission: form.allow_workflow_runs_without_permission,
        timezone: form.timezone,
        preset_key: form.scheduleMode === 'preset' ? form.preset_key : null,
        cron_expression: form.scheduleMode === 'cron' ? form.cron_expression : null,
    });

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!token) return;
        setSaving(true);
        try {
            const payload = buildPayload();
            if (form.id) {
                await axiosInstance.patch(`/api/cronjobs/${form.id}`, payload, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success('Cronjob updated');
            } else {
                await axiosInstance.post('/api/cronjobs', payload, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success('Cronjob created');
            }
            resetForm();
            await fetchCronjobs();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to save cronjob'));
        } finally {
            setSaving(false);
        }
    };

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
        if (!token) return;
        try {
            await axiosInstance.post(`/api/cronjobs/${cronjob.id}/run-now`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Cronjob run started');
            await fetchCronjobs();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to start cronjob'));
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

    const loadRuns = async (cronjob: Cronjob) => {
        if (!token) return;
        if (expandedCronjobId === cronjob.id) {
            setExpandedCronjobId(null);
            return;
        }
        try {
            const response = await axiosInstance.get(`/api/cronjobs/${cronjob.id}/runs`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setRunsByCronjob((prev) => ({ ...prev, [cronjob.id]: response.data.runs }));
            setExpandedCronjobId(cronjob.id);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to load cronjob runs'));
        }
    };

    if (loading) {
        return <div className="section-loading">Loading cronjobs...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    return (
        <div className="cronjobs-section-content">
            <form className="cronjob-form workflow-card" onSubmit={handleSubmit}>
                <div className="cronjob-form-header">
                    <div>
                        <h3>{form.id ? 'Edit Cronjob' : 'Create Cronjob'}</h3>
                        <p>Scheduled prompts run in hidden agent sessions and only surface when the run needs user input.</p>
                    </div>
                    {form.id && (
                        <button type="button" onClick={resetForm}>
                            Cancel edit
                        </button>
                    )}
                </div>

                <label className="cronjob-field">
                    <span>Name</span>
                    <input
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Morning repo check"
                        required
                    />
                </label>

                <label className="cronjob-field">
                    <span>Prompt</span>
                    <textarea
                        value={form.prompt}
                        onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))}
                        placeholder="Check the repo health, run the relevant workflow, and mark the cronjob completed with a summary."
                        required
                        rows={5}
                    />
                </label>

                <div className="cronjob-form-grid">
                    <label className="cronjob-field">
                        <span>Schedule type</span>
                        <select
                            value={form.scheduleMode}
                            onChange={(event) => setForm((prev) => ({ ...prev, scheduleMode: event.target.value as ScheduleMode }))}
                        >
                            <option value="preset">Preset</option>
                            <option value="cron">Cron expression</option>
                        </select>
                    </label>

                    {form.scheduleMode === 'preset' ? (
                        <label className="cronjob-field">
                            <span>Preset</span>
                            <select
                                value={form.preset_key}
                                onChange={(event) => setForm((prev) => ({ ...prev, preset_key: event.target.value }))}
                            >
                                {PRESETS.map((preset) => (
                                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label className="cronjob-field">
                            <span>Cron expression</span>
                            <input
                                value={form.cron_expression}
                                onChange={(event) => setForm((prev) => ({ ...prev, cron_expression: event.target.value }))}
                                placeholder="0 9 * * *"
                                required
                            />
                        </label>
                    )}

                    <label className="cronjob-field">
                        <span>Timezone</span>
                        <input
                            value={form.timezone}
                            onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                            placeholder="UTC"
                            required
                        />
                    </label>
                </div>

                <div className="cronjob-checkbox-row">
                    <label>
                        <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                        />
                        Enabled
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={form.allow_workflow_runs_without_permission}
                            onChange={(event) => setForm((prev) => ({ ...prev, allow_workflow_runs_without_permission: event.target.checked }))}
                        />
                        Allow workflow runs without user permission
                    </label>
                </div>

                <button className="workflow-card-run-btn" type="submit" disabled={saving}>
                    {saving ? 'Saving...' : form.id ? 'Save Cronjob' : 'Create Cronjob'}
                </button>
            </form>

            {cronjobs.length === 0 ? (
                <div className="section-empty">
                    <h3>No Cronjobs Yet</h3>
                    <p>Create one above to run an agent prompt on a schedule.</p>
                </div>
            ) : (
                <div className="workflows-grid">
                    {cronjobs.map((cronjob) => (
                        <div className="workflow-card cronjob-card" key={cronjob.id}>
                            <div className="workflow-card-header">
                                <h3 className="workflow-card-title">{cronjob.name}</h3>
                                <span className={`cronjob-status-badge ${cronjob.enabled ? 'enabled' : 'disabled'}`}>
                                    {cronjob.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                            <p className="workflow-card-description cronjob-prompt">{cronjob.prompt}</p>
                            <p className="workflow-card-meta">Schedule: {scheduleLabel(cronjob)} in {cronjob.schedule.timezone}</p>
                            <p className="workflow-card-meta">Next run: {formatTimestamp(cronjob.next_run_at)}</p>
                            <p className="workflow-card-meta">
                                Latest run: {cronjob.latest_run ? `${statusLabel(cronjob.latest_run.status)} at ${formatTimestamp(cronjob.latest_run.started_at)}` : 'Never run'}
                            </p>
                            <p className="workflow-card-meta">
                                Workflow permission: {cronjob.allow_workflow_runs_without_permission ? 'Allowed without prompting' : 'Ask user first'}
                            </p>

                            <div className="workflow-card-actions">
                                <button className="workflow-card-run-btn" onClick={() => runNow(cronjob)}>
                                    Run now
                                </button>
                                <button className="workflow-card-run-btn" onClick={() => toggleEnabled(cronjob)}>
                                    {cronjob.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button className="workflow-card-run-btn" onClick={() => startEdit(cronjob)}>
                                    Edit
                                </button>
                                <button className="workflow-card-run-btn" onClick={() => loadRuns(cronjob)}>
                                    {expandedCronjobId === cronjob.id ? 'Hide runs' : 'Runs'}
                                </button>
                                <button className="workflow-card-delete-btn" onClick={() => deleteCronjob(cronjob)}>
                                    Delete
                                </button>
                            </div>

                            {expandedCronjobId === cronjob.id && (
                                <div className="cronjob-runs">
                                    {(runsByCronjob[cronjob.id] ?? []).length === 0 ? (
                                        <p className="workflow-card-meta">No runs yet.</p>
                                    ) : (
                                        (runsByCronjob[cronjob.id] ?? []).map((run) => (
                                            <div className="cronjob-run-row" key={run.id}>
                                                <div>
                                                    <strong>{statusLabel(run.status)}</strong>
                                                    <span>{formatTimestamp(run.started_at)}</span>
                                                </div>
                                                {run.summary && <p>{run.summary}</p>}
                                                {run.needs_user_input_reason && <p>{run.needs_user_input_reason}</p>}
                                                {run.error_message && <p>{run.error_message}</p>}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

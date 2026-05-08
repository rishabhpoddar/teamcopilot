import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import './CronjobFormPage.css';

type ScheduleMode = 'preset' | 'cron';

interface CronjobSchedule {
    preset_key: string | null;
    cron_expression: string | null;
    timezone: string;
    effective_cron_expression: string;
}

interface Cronjob {
    id: string;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    schedule: CronjobSchedule;
}

interface CronjobFormState {
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    scheduleMode: ScheduleMode;
    preset_key: string;
    cron_expression: string;
    timezone: string;
}

const PRESETS: Array<{ key: string; label: string; description: string }> = [
    { key: 'hourly', label: 'Hourly', description: 'At the top of every hour' },
    { key: 'daily', label: 'Daily', description: 'Every day at 9:00' },
    { key: 'weekdays', label: 'Weekdays', description: 'Monday to Friday at 9:00' },
    { key: 'weekly', label: 'Weekly', description: 'Every Monday at 9:00' },
];

function getLocalTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function emptyForm(): CronjobFormState {
    return {
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

function formFromCronjob(cronjob: Cronjob): CronjobFormState {
    return {
        name: cronjob.name,
        prompt: cronjob.prompt,
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
        scheduleMode: cronjob.schedule.preset_key ? 'preset' : 'cron',
        preset_key: cronjob.schedule.preset_key ?? 'daily',
        cron_expression: cronjob.schedule.cron_expression ?? cronjob.schedule.effective_cron_expression,
        timezone: cronjob.schedule.timezone,
    };
}

export default function CronjobFormPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const params = useParams();
    const cronjobId = params.id ?? null;
    const isEditing = cronjobId !== null;
    const token = auth.loading ? null : auth.token;
    const [form, setForm] = useState<CronjobFormState>(() => emptyForm());
    const [loading, setLoading] = useState(isEditing);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    usePageTitle(isEditing ? 'Edit Cronjob' : 'Create Cronjob');

    const loadCronjob = useCallback(async () => {
        if (!token || !cronjobId) return;
        try {
            const response = await axiosInstance.get(`/api/cronjobs/${cronjobId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setForm(formFromCronjob(response.data.cronjob));
            setError(null);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load cronjob'));
        } finally {
            setLoading(false);
        }
    }, [cronjobId, token]);

    useEffect(() => {
        if (isEditing) {
            loadCronjob();
        }
    }, [isEditing, loadCronjob]);

    if (auth.loading) return null;

    const buildPayload = () => ({
        name: form.name,
        prompt: form.prompt,
        enabled: form.enabled,
        allow_workflow_runs_without_permission: form.allow_workflow_runs_without_permission,
        timezone: form.timezone,
        preset_key: form.scheduleMode === 'preset' ? form.preset_key : null,
        cron_expression: form.scheduleMode === 'cron' ? form.cron_expression : null,
    });

    const saveCronjob = async (event: FormEvent) => {
        event.preventDefault();
        if (!token) return;
        setSaving(true);
        try {
            if (cronjobId) {
                await axiosInstance.patch(`/api/cronjobs/${cronjobId}`, buildPayload(), {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success('Cronjob updated');
            } else {
                await axiosInstance.post('/api/cronjobs', buildPayload(), {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success('Cronjob created');
            }
            navigate('/?tab=cronjobs');
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to save cronjob'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="cronjob-page-state">Loading cronjob...</div>;
    }

    if (error) {
        return <div className="cronjob-page-state error">{error}</div>;
    }

    const selectedPreset = PRESETS.find((preset) => preset.key === form.preset_key) ?? PRESETS[1];

    return (
        <main className="cronjob-form-page">
            <button className="cronjob-back-btn" onClick={() => navigate('/?tab=cronjobs')}>
                Back to cronjobs
            </button>

            <section className="cronjob-builder-shell">
                <aside className="cronjob-builder-aside">
                    <p className="cronjobs-eyebrow">Scheduled agent</p>
                    <h1>{isEditing ? 'Edit cronjob' : 'Create a cronjob'}</h1>
                    <p>
                        Define a prompt that should complete without user input. If the agent gets blocked,
                        TeamCopilot reveals the hidden session as a normal chat.
                    </p>
                    <div className="cronjob-builder-card">
                        <span>Completion model</span>
                        <strong>Tool-call required</strong>
                        <p>The agent must call <code>markCronjobCompleted</code>. If it stops without that call, the run escalates.</p>
                    </div>
                </aside>

                <form className="cronjob-builder-form" onSubmit={saveCronjob}>
                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>01</span>
                            <div>
                                <h2>What should run?</h2>
                                <p>Name the recurring task and write the exact agent prompt.</p>
                            </div>
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
                                placeholder="Check the repo health, run the relevant workflow if needed, and mark the cronjob completed with a concise summary."
                                required
                            />
                        </label>
                    </section>

                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>02</span>
                            <div>
                                <h2>When should it run?</h2>
                                <p>Use a preset for common schedules or a cron expression for full control.</p>
                            </div>
                        </div>

                        <div className="cronjob-schedule-toggle" role="tablist" aria-label="Schedule type">
                            <button
                                type="button"
                                className={form.scheduleMode === 'preset' ? 'active' : ''}
                                onClick={() => setForm((prev) => ({ ...prev, scheduleMode: 'preset' }))}
                            >
                                Preset
                            </button>
                            <button
                                type="button"
                                className={form.scheduleMode === 'cron' ? 'active' : ''}
                                onClick={() => setForm((prev) => ({ ...prev, scheduleMode: 'cron' }))}
                            >
                                Cron expression
                            </button>
                        </div>

                        {form.scheduleMode === 'preset' ? (
                            <div className="cronjob-preset-grid">
                                {PRESETS.map((preset) => (
                                    <button
                                        type="button"
                                        key={preset.key}
                                        className={form.preset_key === preset.key ? 'active' : ''}
                                        onClick={() => setForm((prev) => ({ ...prev, preset_key: preset.key }))}
                                    >
                                        <strong>{preset.label}</strong>
                                        <span>{preset.description}</span>
                                    </button>
                                ))}
                            </div>
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

                        <div className="cronjob-form-grid">
                            <label className="cronjob-field">
                                <span>Timezone</span>
                                <input
                                    value={form.timezone}
                                    onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                                    placeholder="UTC"
                                    required
                                />
                            </label>
                            <div className="cronjob-schedule-preview">
                                <span>Schedule preview</span>
                                <strong>
                                    {form.scheduleMode === 'preset'
                                        ? `${selectedPreset.label}: ${selectedPreset.description}`
                                        : form.cron_expression}
                                </strong>
                            </div>
                        </div>
                    </section>

                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>03</span>
                            <div>
                                <h2>Runtime policy</h2>
                                <p>Choose how aggressively the cronjob should avoid asking for help.</p>
                            </div>
                        </div>

                        <label className="cronjob-switch-row">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                            />
                            <span>
                                <strong>Enabled</strong>
                                <small>Schedule this cronjob after saving.</small>
                            </span>
                        </label>

                        <label className="cronjob-switch-row">
                            <input
                                type="checkbox"
                                checked={form.allow_workflow_runs_without_permission}
                                onChange={(event) => setForm((prev) => ({ ...prev, allow_workflow_runs_without_permission: event.target.checked }))}
                            />
                            <span>
                                <strong>Allow workflow runs without user permission</strong>
                                <small>If off, workflow execution can escalate the cronjob into a user-visible chat.</small>
                            </span>
                        </label>
                    </section>

                    <div className="cronjob-builder-actions">
                        <button type="button" onClick={() => navigate('/?tab=cronjobs')}>
                            Cancel
                        </button>
                        <button className="cronjobs-primary-btn" type="submit" disabled={saving}>
                            {saving ? 'Saving...' : isEditing ? 'Save cronjob' : 'Create cronjob'}
                        </button>
                    </div>
                </form>
            </section>
        </main>
    );
}

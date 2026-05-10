import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import type { WorkflowInput } from '../types/workflow';
import './CronjobFormPage.css';

type ScheduleMode = 'builder' | 'cron';
type BuilderFrequency = 'daily' | 'weekly' | 'monthly';
type TargetMode = 'prompt' | 'workflow';
type WorkflowFormValue = string | boolean;

interface CronjobSchedule {
    cron_expression: string;
    timezone: string;
    effective_cron_expression: string;
}

interface Cronjob {
    id: string;
    name: string;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    target: {
        target_type: TargetMode;
        prompt: string | null;
        prompt_allow_workflow_runs_without_permission: boolean | null;
        workflow_slug: string | null;
        workflow_inputs: Record<string, unknown> | null;
    };
    schedule: CronjobSchedule;
}

interface WorkflowSummary {
    slug: string;
    name: string;
    intent_summary: string;
    is_approved: boolean;
    can_edit: boolean;
    missing_required_secrets: string[];
}

interface WorkflowDetails {
    slug: string;
    name: string;
    required_secrets: string[];
    missing_required_secrets: string[];
    manifest: {
        inputs: Record<string, WorkflowInput>;
    };
}

interface CronjobFormState {
    name: string;
    targetMode: TargetMode;
    prompt: string;
    enabled: boolean;
    allow_workflow_runs_without_permission: boolean;
    workflow_slug: string;
    workflow_inputs: Record<string, WorkflowFormValue>;
    scheduleMode: ScheduleMode;
    cron_expression: string;
    timezone: string;
    builderFrequency: BuilderFrequency;
    time: string;
    days_of_week: number[];
    day_of_month: number;
}

const DAYS_OF_WEEK = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' },
];

const FALLBACK_TIMEZONES = ['UTC', 'Asia/Calcutta', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

function getLocalTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function getTimezoneOptions(): string[] {
    const supportedValuesOf = Intl.supportedValuesOf as ((key: 'timeZone') => string[]) | undefined;
    const timezones = supportedValuesOf ? supportedValuesOf('timeZone') : FALLBACK_TIMEZONES;
    const localTimezone = getLocalTimezone();
    return Array.from(new Set([localTimezone, ...timezones])).sort();
}

function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(minutes: number | null): string {
    const value = minutes ?? 540;
    const hours = Math.floor(value / 60).toString().padStart(2, '0');
    const mins = (value % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
}

function buildCronExpressionFromBuilder(form: CronjobFormState): string {
    const timeMinutes = timeToMinutes(form.time);
    const minute = timeMinutes % 60;
    const hour = Math.floor(timeMinutes / 60);
    if (form.builderFrequency === 'monthly') {
        return `${minute} ${hour} ${form.day_of_month} * *`;
    }
    if (form.builderFrequency === 'weekly') {
        return `${minute} ${hour} * * ${form.days_of_week.join(',')}`;
    }
    return `${minute} ${hour} * * *`;
}

function emptyForm(): CronjobFormState {
    return {
        name: '',
        targetMode: 'prompt',
        prompt: '',
        enabled: true,
        allow_workflow_runs_without_permission: true,
        workflow_slug: '',
        workflow_inputs: {},
        scheduleMode: 'builder',
        cron_expression: '0 9 * * *',
        timezone: getLocalTimezone(),
        builderFrequency: 'daily',
        time: '09:00',
        days_of_week: [1, 2, 3, 4, 5],
        day_of_month: 1,
    };
}

function buildInitialWorkflowInputs(inputs: Record<string, WorkflowInput>, existingInputs: Record<string, unknown> = {}): Record<string, WorkflowFormValue> {
    const values: Record<string, WorkflowFormValue> = {};
    for (const [key, input] of Object.entries(inputs)) {
        const existingValue = existingInputs[key];
        if (input.type === 'boolean') {
            values[key] = typeof existingValue === 'boolean' ? existingValue : input.default === true;
        } else if (existingValue !== undefined && existingValue !== null) {
            values[key] = String(existingValue);
        } else if (input.default !== undefined) {
            values[key] = String(input.default);
        } else {
            values[key] = '';
        }
    }
    return values;
}

function parseWorkflowInputsForPayload(inputs: Record<string, WorkflowInput>, values: Record<string, WorkflowFormValue>): Record<string, string | number | boolean> | null {
    const parsedInputs: Record<string, string | number | boolean> = {};
    for (const [key, input] of Object.entries(inputs)) {
        const value = values[key];
        if (input.type === 'boolean') {
            parsedInputs[key] = Boolean(value);
            continue;
        }

        const rawValue = typeof value === 'string' ? value : String(value);
        const trimmed = rawValue.trim();
        if (trimmed.length === 0) {
            if (input.required !== false && input.default === undefined) {
                toast.error(`Missing required workflow input: ${key}`);
                return null;
            }
            continue;
        }

        if (input.type === 'number') {
            const numberValue = Number(trimmed);
            if (!Number.isFinite(numberValue)) {
                toast.error(`Invalid number for workflow input: ${key}`);
                return null;
            }
            parsedInputs[key] = numberValue;
            continue;
        }

        parsedInputs[key] = trimmed;
    }
    return parsedInputs;
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
        targetMode: cronjob.target?.target_type ?? 'prompt',
        prompt: cronjob.prompt,
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
        workflow_slug: cronjob.target?.workflow_slug ?? '',
        workflow_inputs: {},
        scheduleMode: 'cron',
        cron_expression: cronjob.schedule.cron_expression,
        timezone: cronjob.schedule.timezone,
        builderFrequency: 'daily',
        time: minutesToTime(null),
        days_of_week: [1, 2, 3, 4, 5],
        day_of_month: 1,
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
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDetails | null>(null);
    const [workflowLoading, setWorkflowLoading] = useState(false);
    const [workflowError, setWorkflowError] = useState<string | null>(null);
    const pendingWorkflowInputsRef = useRef<Record<string, unknown>>({});

    usePageTitle(isEditing ? 'Edit Cronjob' : 'Create Cronjob');

    const loadCronjob = useCallback(async () => {
        if (!token || !cronjobId) return;
        try {
            const response = await axiosInstance.get(`/api/cronjobs/${cronjobId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const cronjob = response.data.cronjob as Cronjob;
            setForm(formFromCronjob(cronjob));
            pendingWorkflowInputsRef.current = cronjob.target?.workflow_inputs ?? {};
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

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        const loadWorkflows = async () => {
            try {
                const response = await axiosInstance.get('/api/workflows', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!cancelled) {
                    setWorkflows((response.data.workflows as WorkflowSummary[]).filter((workflow) => workflow.is_approved && workflow.can_edit));
                }
            } catch (err: unknown) {
                if (!cancelled) setWorkflowError(getErrorMessage(err, 'Failed to load workflows'));
            }
        };
        void loadWorkflows();
        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        if (!token || form.targetMode !== 'workflow' || !form.workflow_slug) {
            setSelectedWorkflow(null);
            return;
        }
        let cancelled = false;
        const loadWorkflow = async () => {
            setWorkflowLoading(true);
            setWorkflowError(null);
            try {
                const response = await axiosInstance.get(`/api/workflows/${encodeURIComponent(form.workflow_slug)}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const workflow = response.data.workflow as WorkflowDetails;
                if (!cancelled) {
                    setSelectedWorkflow(workflow);
                    const pendingWorkflowInputs = pendingWorkflowInputsRef.current;
                    pendingWorkflowInputsRef.current = {};
                    setForm((prev) => ({
                        ...prev,
                        workflow_inputs: buildInitialWorkflowInputs(workflow.manifest.inputs ?? {}, pendingWorkflowInputs),
                    }));
                }
            } catch (err: unknown) {
                if (!cancelled) setWorkflowError(getErrorMessage(err, 'Failed to load workflow details'));
            } finally {
                if (!cancelled) setWorkflowLoading(false);
            }
        };
        void loadWorkflow();
        return () => {
            cancelled = true;
        };
    }, [form.targetMode, form.workflow_slug, token]);

    if (auth.loading) return null;

    const buildPayload = () => {
        const workflowInputs = form.targetMode === 'workflow'
            ? parseWorkflowInputsForPayload(selectedWorkflow?.manifest.inputs ?? {}, form.workflow_inputs)
            : null;
        if (form.targetMode === 'workflow' && workflowInputs === null) {
            return null;
        }
        const basePayload = {
            name: form.name,
            target_type: form.targetMode,
            prompt: form.targetMode === 'prompt' ? form.prompt : null,
            workflow_slug: form.targetMode === 'workflow' ? form.workflow_slug : null,
            workflow_inputs: form.targetMode === 'workflow' ? workflowInputs : null,
            enabled: form.enabled,
            allow_workflow_runs_without_permission: form.targetMode === 'prompt' ? form.allow_workflow_runs_without_permission : null,
            timezone: form.timezone,
        };
        return {
            ...basePayload,
            cron_expression: form.scheduleMode === 'cron' ? form.cron_expression : buildCronExpressionFromBuilder(form),
        };
    };

    const toggleDay = (day: number) => {
        setForm((prev) => {
            const nextDays = prev.days_of_week.includes(day)
                ? prev.days_of_week.filter((candidate) => candidate !== day)
                : [...prev.days_of_week, day].sort((a, b) => a - b);
            return { ...prev, days_of_week: nextDays.length === 0 ? prev.days_of_week : nextDays };
        });
    };

    const saveCronjob = async (event: FormEvent) => {
        event.preventDefault();
        if (!token) return;
        const payload = buildPayload();
        if (payload === null) return;
        setSaving(true);
        try {
            if (cronjobId) {
                await axiosInstance.patch(`/api/cronjobs/${cronjobId}`, payload, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                toast.success('Cronjob updated');
            } else {
                await axiosInstance.post('/api/cronjobs', payload, {
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

    const timezoneOptions = getTimezoneOptions();

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
                        Define a prompt or workflow that should run on a schedule. Prompts can invoke workflows or other skills.
                    </p>
                </aside>

                <form className="cronjob-builder-form" onSubmit={saveCronjob}>
                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>01</span>
                            <div>
                                <h2>What should run?</h2>
                                <p>Run either an agent prompt or a specific workflow with fixed inputs.</p>
                            </div>
                        </div>
                        <div className="cronjob-form-grid">
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
                                <span>Target type</span>
                                <div className="cronjob-select-wrap">
                                    <select
                                        value={form.targetMode}
                                        onChange={(event) => setForm((prev) => ({ ...prev, targetMode: event.target.value as TargetMode }))}
                                    >
                                        <option value="prompt">Prompt</option>
                                        <option value="workflow">Workflow</option>
                                    </select>
                                </div>
                            </label>
                        </div>
                        {form.targetMode === 'prompt' ? (
                            <label className="cronjob-field">
                                <span>Prompt</span>
                                <textarea
                                    value={form.prompt}
                                    onChange={(event) => setForm((prev) => ({ ...prev, prompt: event.target.value }))}
                                    placeholder="Check the repo health, run the relevant workflow if needed, and mark the cronjob completed with a concise summary."
                                    required
                                />
                            </label>
                        ) : (
                            <div className="cronjob-workflow-target">
                                <label className="cronjob-field">
                                    <span>Workflow</span>
                                    <div className="cronjob-select-wrap">
                                        <select
                                            value={form.workflow_slug}
                                            onChange={(event) => setForm((prev) => ({ ...prev, workflow_slug: event.target.value, workflow_inputs: {} }))}
                                            required
                                        >
                                            <option value="">Select workflow</option>
                                            {workflows.map((workflow) => (
                                                <option key={workflow.slug} value={workflow.slug}>
                                                    {workflow.name || workflow.slug}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </label>
                                {workflowError && <p className="cronjob-inline-error">{workflowError}</p>}
                                {workflowLoading && <p className="cronjob-muted-copy">Loading workflow inputs...</p>}
                                {selectedWorkflow && (
                                    <div className="cronjob-workflow-inputs">
                                        <p>
                                            {selectedWorkflow.required_secrets.length > 0
                                                ? `Required secrets: ${selectedWorkflow.required_secrets.join(', ')}`
                                                : 'This workflow does not declare required secrets.'}
                                        </p>
                                        {selectedWorkflow.missing_required_secrets.length > 0 && (
                                            <p className="cronjob-inline-error">
                                                Missing secrets: {selectedWorkflow.missing_required_secrets.join(', ')}
                                            </p>
                                        )}
                                        {Object.keys(selectedWorkflow.manifest.inputs ?? {}).length === 0 ? (
                                            <p className="cronjob-muted-copy">This workflow does not take input arguments.</p>
                                        ) : (
                                            <div className="cronjob-form-grid">
                                                {Object.entries(selectedWorkflow.manifest.inputs).map(([key, input]) => (
                                                    <label key={key} className="cronjob-field">
                                                        <span>
                                                            {key}
                                                            {input.required !== false ? ' *' : ''}
                                                        </span>
                                                        {input.description && <small className="cronjob-muted-copy">{input.description}</small>}
                                                        {input.type === 'boolean' ? (
                                                            <div className="cronjob-day-picker">
                                                                <button
                                                                    type="button"
                                                                    className={form.workflow_inputs[key] === true ? 'active' : ''}
                                                                    onClick={() => setForm((prev) => ({
                                                                        ...prev,
                                                                        workflow_inputs: { ...prev.workflow_inputs, [key]: true },
                                                                    }))}
                                                                >
                                                                    Yes
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={form.workflow_inputs[key] !== true ? 'active' : ''}
                                                                    onClick={() => setForm((prev) => ({
                                                                        ...prev,
                                                                        workflow_inputs: { ...prev.workflow_inputs, [key]: false },
                                                                    }))}
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <input
                                                                type={input.type === 'number' ? 'number' : 'text'}
                                                                value={String(form.workflow_inputs[key] ?? '')}
                                                                onChange={(event) => setForm((prev) => ({
                                                                    ...prev,
                                                                    workflow_inputs: { ...prev.workflow_inputs, [key]: event.target.value },
                                                                }))}
                                                                placeholder={input.default !== undefined ? String(input.default) : ''}
                                                                required={input.required !== false && input.default === undefined}
                                                            />
                                                        )}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>02</span>
                            <div>
                                <h2>When should it run?</h2>
                                <p>Use the schedule builder for common schedules or enter raw cron for full control.</p>
                            </div>
                        </div>

                        <div className="cronjob-form-grid">
                            <label className="cronjob-field">
                                <span>Schedule type</span>
                                <div className="cronjob-select-wrap">
                                    <select
                                        value={form.scheduleMode}
                                        onChange={(event) => setForm((prev) => ({ ...prev, scheduleMode: event.target.value as ScheduleMode }))}
                                    >
                                        <option value="builder">Schedule builder</option>
                                        <option value="cron">Cron expression</option>
                                    </select>
                                </div>
                            </label>
                            {form.scheduleMode === 'builder' ? (
                                <label className="cronjob-field">
                                    <span>Timezone</span>
                                    <div className="cronjob-select-wrap">
                                        <select
                                            value={form.timezone}
                                            onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                                        >
                                            {timezoneOptions.map((timezone) => (
                                                <option key={timezone} value={timezone}>
                                                    {timezone}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
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
                        </div>

                        {form.scheduleMode === 'builder' ? (
                            <>
                                <div className="cronjob-form-grid">
                                    <label className="cronjob-field">
                                        <span>Frequency</span>
                                        <div className="cronjob-select-wrap">
                                            <select
                                                value={form.builderFrequency}
                                                onChange={(event) => setForm((prev) => ({ ...prev, builderFrequency: event.target.value as BuilderFrequency }))}
                                            >
                                                <option value="daily">Every day</option>
                                                <option value="weekly">Specific weekdays</option>
                                                <option value="monthly">Specific day of month</option>
                                            </select>
                                        </div>
                                    </label>
                                    <label className="cronjob-field">
                                        <span>Time of day</span>
                                        <input
                                            type="time"
                                            value={form.time}
                                            onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                                            required
                                        />
                                    </label>
                                </div>

                                {form.builderFrequency === 'weekly' ? (
                                    <>
                                        <div className="cronjob-day-picker" aria-label="Days of week">
                                            {DAYS_OF_WEEK.map((day) => (
                                                <button
                                                    key={day.value}
                                                    type="button"
                                                    className={form.days_of_week.includes(day.value) ? 'active' : ''}
                                                    onClick={() => toggleDay(day.value)}
                                                >
                                                    {day.label}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                ) : null}

                                {form.builderFrequency === 'monthly' ? (
                                    <label className="cronjob-field cronjob-short-field">
                                        <span>Day of month</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={31}
                                            value={form.day_of_month}
                                            onChange={(event) => setForm((prev) => ({ ...prev, day_of_month: Number(event.target.value) }))}
                                            required
                                        />
                                    </label>
                                ) : null}
                            </>
                        ) : (
                            <label className="cronjob-field">
                                <span>Timezone</span>
                                <div className="cronjob-select-wrap">
                                    <select
                                        value={form.timezone}
                                        onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                                    >
                                        {timezoneOptions.map((timezone) => (
                                            <option key={timezone} value={timezone}>
                                                {timezone}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </label>
                        )}
                    </section>

                    <section className="cronjob-form-panel">
                        <div className="cronjob-panel-heading">
                            <span>03</span>
                            <div>
                                <h2>Runtime policy</h2>
                                <p>{form.targetMode === 'workflow' ? 'Workflow cronjobs run directly with the saved inputs.' : 'Choose how aggressively the cronjob should avoid asking for help.'}</p>
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

                        {form.targetMode === 'prompt' ? (
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
                        ) : (
                            <div className="cronjob-policy-note">
                                Workflow cronjobs do not request runtime permission.
                            </div>
                        )}
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

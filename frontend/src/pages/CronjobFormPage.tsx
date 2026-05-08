import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import './CronjobFormPage.css';

type ScheduleMode = 'builder' | 'cron';
type BuilderFrequency = 'daily' | 'weekly' | 'monthly';

interface CronjobSchedule {
    preset_key: string | null;
    cron_expression: string | null;
    timezone: string;
    schedule_type: string;
    time_minutes: number | null;
    days_of_week: number[] | null;
    week_interval: number | null;
    anchor_date: string | null;
    day_of_month: number | null;
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
    cron_expression: string;
    timezone: string;
    builderFrequency: BuilderFrequency;
    time: string;
    days_of_week: number[];
    week_interval: number;
    anchor_date: string;
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

function getTodayDate(): string {
    return new Date().toISOString().slice(0, 10);
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

function emptyForm(): CronjobFormState {
    return {
        name: '',
        prompt: '',
        enabled: true,
        allow_workflow_runs_without_permission: true,
        scheduleMode: 'builder',
        cron_expression: '0 9 * * *',
        timezone: getLocalTimezone(),
        builderFrequency: 'daily',
        time: '09:00',
        days_of_week: [1, 2, 3, 4, 5],
        week_interval: 1,
        anchor_date: getTodayDate(),
        day_of_month: 1,
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
    const scheduleMode: ScheduleMode = cronjob.schedule.schedule_type === 'structured' ? 'builder' : 'cron';
    const selectedDays = cronjob.schedule.days_of_week ?? [1, 2, 3, 4, 5];
    const builderFrequency: BuilderFrequency = cronjob.schedule.day_of_month !== null
        ? 'monthly'
        : cronjob.schedule.days_of_week === null || selectedDays.length === 7
            ? 'daily'
            : 'weekly';
    return {
        name: cronjob.name,
        prompt: cronjob.prompt,
        enabled: cronjob.enabled,
        allow_workflow_runs_without_permission: cronjob.allow_workflow_runs_without_permission,
        scheduleMode,
        cron_expression: cronjob.schedule.cron_expression ?? cronjob.schedule.effective_cron_expression,
        timezone: cronjob.schedule.timezone,
        builderFrequency,
        time: minutesToTime(cronjob.schedule.time_minutes),
        days_of_week: selectedDays.length === 7 ? [1, 2, 3, 4, 5] : selectedDays,
        week_interval: cronjob.schedule.week_interval ?? 1,
        anchor_date: cronjob.schedule.anchor_date ?? getTodayDate(),
        day_of_month: cronjob.schedule.day_of_month ?? 1,
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

    const buildPayload = () => {
        const basePayload = {
            name: form.name,
            prompt: form.prompt,
            enabled: form.enabled,
            allow_workflow_runs_without_permission: form.allow_workflow_runs_without_permission,
            timezone: form.timezone,
        };
        if (form.scheduleMode === 'cron') {
            return {
                ...basePayload,
                schedule_type: 'cron',
                preset_key: null,
                cron_expression: form.cron_expression,
                time_minutes: null,
                days_of_week: null,
                week_interval: null,
                anchor_date: null,
                day_of_month: null,
            };
        }
        return {
            ...basePayload,
            schedule_type: 'structured',
            preset_key: null,
            cron_expression: null,
            time_minutes: timeToMinutes(form.time),
            days_of_week: form.builderFrequency === 'monthly' ? null : form.builderFrequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : form.days_of_week,
            week_interval: form.builderFrequency === 'weekly' ? form.week_interval : 1,
            anchor_date: form.anchor_date,
            day_of_month: form.builderFrequency === 'monthly' ? form.day_of_month : null,
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
                        Define a prompt that should run on a schedule. Prompts can invoke workflows or other skills.
                    </p>
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
                                        <div className="cronjob-form-grid">
                                            <label className="cronjob-field">
                                                <span>Repeat every</span>
                                                <div className="cronjob-inline-field">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={52}
                                                        value={form.week_interval}
                                                        onChange={(event) => setForm((prev) => ({ ...prev, week_interval: Number(event.target.value) }))}
                                                        required
                                                    />
                                                    <small>week(s)</small>
                                                </div>
                                            </label>
                                            <label className="cronjob-field">
                                                <span>Starting week</span>
                                                <input
                                                    type="date"
                                                    value={form.anchor_date}
                                                    onChange={(event) => setForm((prev) => ({ ...prev, anchor_date: event.target.value }))}
                                                    required
                                                />
                                            </label>
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

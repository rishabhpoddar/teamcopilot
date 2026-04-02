import { AxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import type { WorkflowInput } from '../types/workflow';
import { axiosInstance } from '../utils';
import './ManualRunPage.css';

interface WorkflowForManualRun {
    slug: string;
    name: string;
    required_secrets: string[];
    missing_required_secrets: string[];
    manifest: {
        inputs: Record<string, WorkflowInput>;
    };
}

type FormValue = string | boolean;

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

function buildInitialFormValues(inputs: Record<string, WorkflowInput>): Record<string, FormValue> {
    const values: Record<string, FormValue> = {};
    for (const [key, config] of Object.entries(inputs)) {
        if (config.type === 'boolean') {
            values[key] = config.default === true;
        } else if (config.default !== undefined) {
            values[key] = String(config.default);
        } else {
            values[key] = '';
        }
    }
    return values;
}

export default function ManualRunPage() {
    const { slug = '' } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<WorkflowForManualRun | null>(null);
    const [formValues, setFormValues] = useState<Record<string, FormValue>>({});

    usePageTitle('Manual Run');

    const authHeader = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

    useEffect(() => {
        if (!authHeader) return;
        let cancelled = false;

        const fetchWorkflow = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await axiosInstance.get(`/api/workflows/${encodeURIComponent(slug)}`, {
                    headers: authHeader
                });
                const data = response.data.workflow as WorkflowForManualRun;
                if (!cancelled) {
                    setWorkflow(data);
                    setFormValues(buildInitialFormValues(data.manifest.inputs || {}));
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(getErrorMessage(err, 'Failed to load workflow details'));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void fetchWorkflow();
        return () => {
            cancelled = true;
        };
    }, [authHeader, slug]);

    const handleChange = (key: string, value: FormValue) => {
        setFormValues((prev) => ({
            ...prev,
            [key]: value
        }));
    };

    const handleRun = async () => {
        if (!authHeader || !workflow) return;
        const schema = workflow.manifest.inputs || {};
        const parsedInputs: Record<string, string | number | boolean> = {};

        for (const [key, config] of Object.entries(schema)) {
            const value = formValues[key];

            if (config.type === 'boolean') {
                parsedInputs[key] = Boolean(value);
                continue;
            }

            const rawValue = typeof value === 'string' ? value : String(value);
            const trimmed = rawValue.trim();

            if (trimmed.length === 0) {
                if (config.required !== false && config.default === undefined) {
                    toast.error(`Missing required input: ${key}`);
                    return;
                }
                continue;
            }

            if (config.type === 'number') {
                const num = Number(trimmed);
                if (!Number.isFinite(num)) {
                    toast.error(`Invalid number for input: ${key}`);
                    return;
                }
                parsedInputs[key] = num;
                continue;
            }

            parsedInputs[key] = trimmed;
        }

        setSubmitting(true);
        try {
            const response = await axiosInstance.post(
                `/api/workflows/${encodeURIComponent(slug)}/manual-run`,
                { inputs: parsedInputs },
                { headers: authHeader }
            );
            const runId = String(response.data.run_id);
            navigate(`/runs/${encodeURIComponent(runId)}`);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to start manual workflow run'));
        } finally {
            setSubmitting(false);
        }
    };

    if (auth.loading) return null;

    return (
        <div className="manual-run-page">
            <header className="manual-run-header">
                <button className="manual-run-back-btn" onClick={() => navigate('/?tab=workflows')}>
                    Back to Workflows
                </button>
                <h1>Manual Run</h1>
            </header>

            {loading && <div className="manual-run-state">Loading workflow inputs...</div>}
            {error && <div className="manual-run-state error">{error}</div>}

            {!loading && !error && workflow && (
                <div className="manual-run-content">
                    <section className="manual-run-card">
                        <h2>{workflow.name || workflow.slug}</h2>
                        <p>Provide input values and run the workflow manually.</p>
                        {workflow.required_secrets.length > 0 && (
                            <p>
                                Required secrets: {workflow.required_secrets.join(', ')}
                            </p>
                        )}
                        {workflow.missing_required_secrets.length > 0 && (
                            <p className="manual-run-state error">
                                Missing secrets: {workflow.missing_required_secrets.join(', ')}. Add them in Profile Secrets before running this workflow.
                            </p>
                        )}
                    </section>

                    <section className="manual-run-card">
                        <h3>Inputs</h3>
                        <div className="manual-run-form-grid">
                            {Object.entries(workflow.manifest.inputs || {}).map(([key, input]) => (
                                <label key={key} className="manual-run-field">
                                    <span className="manual-run-field-label">
                                        {key}
                                        {input.required !== false && <span className="manual-run-required">*</span>}
                                    </span>
                                    {input.description && (
                                        <span className="manual-run-field-desc">{input.description}</span>
                                    )}
                                    {input.type === 'boolean' ? (
                                        <div className="manual-run-boolean-group" role="group" aria-label={`${key} boolean input`}>
                                            <button
                                                type="button"
                                                className={`manual-run-boolean-btn ${formValues[key] === true ? 'active' : ''}`}
                                                onClick={() => handleChange(key, true)}
                                            >
                                                Yes
                                            </button>
                                            <button
                                                type="button"
                                                className={`manual-run-boolean-btn ${formValues[key] !== true ? 'active' : ''}`}
                                                onClick={() => handleChange(key, false)}
                                            >
                                                No
                                            </button>
                                        </div>
                                    ) : (
                                        <input
                                            type={input.type === 'number' ? 'number' : 'text'}
                                            value={String(formValues[key] ?? '')}
                                            onChange={(event) => handleChange(key, event.target.value)}
                                            placeholder={input.default !== undefined ? String(input.default) : ''}
                                        />
                                    )}
                                </label>
                            ))}
                        </div>
                        <div className="manual-run-actions">
                            <button
                                type="button"
                                className="manual-run-submit-btn"
                                onClick={() => {
                                    void handleRun();
                                }}
                                disabled={submitting || workflow.missing_required_secrets.length > 0}
                            >
                                {submitting ? 'Starting...' : 'Run Workflow'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}

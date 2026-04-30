import { AxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import type { WorkflowApiKey, WorkflowInput } from '../types/workflow';
import { axiosInstance } from '../utils';
import './WorkflowApiRunPage.css';

interface WorkflowForApiRun {
    slug: string;
    name: string;
    manifest: {
        inputs: Record<string, WorkflowInput>;
    };
}

interface ApiKeysResponse {
    api_base_url: string;
    api_keys: WorkflowApiKey[];
}

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

function exampleValue(input: WorkflowInput): string | number | boolean {
    if (input.default !== undefined) {
        return input.default;
    }
    if (input.type === 'number') {
        return 0;
    }
    if (input.type === 'boolean') {
        return false;
    }
    return 'value';
}

function buildExampleInputs(inputs: Record<string, WorkflowInput>): Record<string, string | number | boolean> {
    const exampleInputs: Record<string, string | number | boolean> = {};
    for (const [key, input] of Object.entries(inputs)) {
        if (input.required === false && input.default === undefined) {
            continue;
        }
        exampleInputs[key] = exampleValue(input);
    }
    return exampleInputs;
}

function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellDoubleQuote(value: string): string {
    return `"${value.replace(/(["\\`])/g, '\\$1')}"`;
}

function buildRunCurl(apiBaseUrl: string, apiKey: string, workflowSlug: string, inputs: Record<string, WorkflowInput>): string {
    const body = {
        workflow_slug: workflowSlug,
        inputs: buildExampleInputs(inputs),
    };
    return [
        `curl -sS -X POST ${shellSingleQuote(`${apiBaseUrl}/runs`)}`,
        `  -H ${shellSingleQuote(`Authorization: Bearer ${apiKey}`)}`,
        `  -H ${shellSingleQuote('Content-Type: application/json')}`,
        `  -d ${shellSingleQuote(JSON.stringify(body, null, 2))}`,
    ].join(' \\\n');
}

function buildStatusCurl(apiBaseUrl: string, apiKey: string): string {
    return [
        `RUN_HANDLE='paste-run-handle-here'`,
        [
            `curl -sS -X GET ${shellDoubleQuote(`${apiBaseUrl}/runs/$RUN_HANDLE`)}`,
            `  -H ${shellSingleQuote(`Authorization: Bearer ${apiKey}`)}`,
        ].join(' \\\n'),
    ].join('\n');
}

function buildStopCurl(apiBaseUrl: string, apiKey: string): string {
    return [
        `RUN_HANDLE='paste-run-handle-here'`,
        [
            `curl -sS -X POST ${shellDoubleQuote(`${apiBaseUrl}/runs/$RUN_HANDLE/stop`)}`,
            `  -H ${shellSingleQuote(`Authorization: Bearer ${apiKey}`)}`,
        ].join(' \\\n'),
    ].join('\n');
}

export default function WorkflowApiRunPage() {
    const { slug = '' } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;

    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<WorkflowForApiRun | null>(null);
    const [apiBaseUrl, setApiBaseUrl] = useState('');
    const [apiKeys, setApiKeys] = useState<WorkflowApiKey[]>([]);

    usePageTitle('Workflow API');

    const authHeader = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

    const fetchData = useCallback(async () => {
        if (!authHeader) return;
        setLoading(true);
        setError(null);
        try {
            const [workflowResponse, keysResponse] = await Promise.all([
                axiosInstance.get(`/api/workflows/${encodeURIComponent(slug)}`, {
                    headers: authHeader
                }),
                axiosInstance.get(`/api/workflows/${encodeURIComponent(slug)}/api-keys`, {
                    headers: authHeader
                })
            ]);
            setWorkflow(workflowResponse.data.workflow as WorkflowForApiRun);
            const keyData = keysResponse.data as ApiKeysResponse;
            setApiBaseUrl(keyData.api_base_url);
            setApiKeys(keyData.api_keys);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load workflow API details'));
        } finally {
            setLoading(false);
        }
    }, [authHeader, slug]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleCreateKey = async () => {
        if (!authHeader) return;
        setCreating(true);
        try {
            const response = await axiosInstance.post(`/api/workflows/${encodeURIComponent(slug)}/api-keys`, {}, {
                headers: authHeader
            });
            setApiKeys((prev) => [...prev, response.data.api_key as WorkflowApiKey]);
            toast.success('API key created');
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to create API key'));
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteKey = async (keyId: string) => {
        if (!authHeader) return;
        setDeletingKeyId(keyId);
        try {
            await axiosInstance.delete(`/api/workflows/${encodeURIComponent(slug)}/api-keys/${encodeURIComponent(keyId)}`, {
                headers: authHeader
            });
            setApiKeys((prev) => prev.filter((key) => key.id !== keyId));
            toast.success('API key removed');
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to remove API key'));
        } finally {
            setDeletingKeyId(null);
        }
    };

    if (auth.loading) return null;

    const primaryKey = apiKeys[0]?.api_key ?? '';
    const inputs = workflow?.manifest.inputs ?? {};
    const runCurl = workflow && primaryKey ? buildRunCurl(apiBaseUrl, primaryKey, workflow.slug, inputs) : '';
    const statusCurl = primaryKey ? buildStatusCurl(apiBaseUrl, primaryKey) : '';
    const stopCurl = primaryKey ? buildStopCurl(apiBaseUrl, primaryKey) : '';
    const schemaJson = JSON.stringify(inputs, null, 2);

    return (
        <div className="workflow-api-page">
            <header className="workflow-api-header">
                <button className="workflow-api-back-btn" onClick={() => navigate('/?tab=workflows')}>
                    Back to Workflows
                </button>
                <h1>Workflow API</h1>
            </header>

            {loading && <div className="workflow-api-state">Loading workflow API details...</div>}
            {error && <div className="workflow-api-state error">{error}</div>}

            {!loading && !error && workflow && (
                <div className="workflow-api-content">
                    <section className="workflow-api-card">
                        <h2>{workflow.name || workflow.slug}</h2>
                        <p>Use this workflow from another backend process with a workflow API key.</p>
                    </section>

                    <section className="workflow-api-card">
                        <h3>Run Command</h3>
                        <pre>{runCurl}</pre>
                    </section>

                    <section className="workflow-api-card">
                        <h3>Status Command</h3>
                        <pre>{statusCurl}</pre>
                    </section>

                    <section className="workflow-api-card">
                        <h3>Stop Command</h3>
                        <pre>{stopCurl}</pre>
                    </section>

                    <section className="workflow-api-card">
                        <h3>Input Schema</h3>
                        <pre>{schemaJson}</pre>
                    </section>

                    <section className="workflow-api-card">
                        <div className="workflow-api-card-title-row">
                            <h3>API Keys</h3>
                            <button type="button" onClick={() => { void handleCreateKey(); }} disabled={creating}>
                                {creating ? 'Creating...' : 'Add Key'}
                            </button>
                        </div>
                        <div className="workflow-api-key-list">
                            {apiKeys.map((key) => (
                                <div className="workflow-api-key-row" key={key.id}>
                                    <code>{key.api_key}</code>
                                    <button
                                        type="button"
                                        onClick={() => { void handleDeleteKey(key.id); }}
                                        disabled={deletingKeyId === key.id || apiKeys.length <= 1}
                                    >
                                        {deletingKeyId === key.id ? 'Removing...' : 'Remove'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}

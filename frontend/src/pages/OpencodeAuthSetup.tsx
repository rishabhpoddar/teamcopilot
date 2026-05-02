import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import './OpencodeAuthSetup.css';

type ProviderAuthMethod = {
    index: number;
    type: 'api' | 'oauth';
    label: string;
};

type StatusResponse = {
    provider_id: string;
    model: string;
    has_credentials: boolean;
    configured_auth_type?: 'api' | 'oauth';
    methods: ProviderAuthMethod[];
};

type OauthAuthorizeResponse = {
    url: string;
    method: 'auto' | 'code';
    instructions: string;
};

type ManagedEnvExample = {
    key: string;
    value: string;
    help: string;
};

function extractDeviceCode(instructions: string): string {
    const match = instructions.match(/enter code:\s*(.+)$/i);
    if (!match || !match[1]) {
        return '';
    }
    return match[1].trim();
}

function isManagedGoogleVertexProvider(providerId: string): boolean {
    const id = providerId.toLowerCase();
    return id === 'google-vertex' || id.startsWith('google-vertex-');
}

function isVisibleAuthMethod(method: ProviderAuthMethod, providerId: string): boolean {
    if (providerId === 'anthropic' && method.type === 'oauth') {
        return false;
    }
    if (method.type !== 'oauth') {
        return true;
    }
    return !method.label.toLowerCase().includes('browser');
}

function getManagedEnvExamples(providerId: string, model: string): ManagedEnvExample[] {
    const modelSuffix = model.split('/').slice(1).join('/');

    if (providerId === 'azure-openai') {
        return [
            {
                key: 'AZURE_API_KEY',
                value: 'abc123xyz',
                help: 'API key for the Azure OpenAI resource.',
            },
            {
                key: 'AZURE_OPENAI_ENDPOINT',
                value: 'https://my-resource.openai.azure.com/',
                help: 'Base endpoint for the Azure OpenAI resource.',
            },
            {
                key: 'OPENCODE_MODEL',
                value: `azure-openai/${modelSuffix}`,
                help: 'Provider id plus the Azure deployment name.',
            },
        ];
    }

    if (isManagedGoogleVertexProvider(providerId)) {
        return [
            {
                key: 'GOOGLE_CLOUD_PROJECT',
                value: 'my-gcp-project-id',
                help: 'Google Cloud project ID. You may use GOOGLE_CLOUD_PROJECT, GCP_PROJECT, or GCLOUD_PROJECT.',
            },
            {
                key: 'GOOGLE_APPLICATION_CREDENTIALS',
                value: '/path/to/service-account.json',
                help: 'Path to a Google Cloud service account JSON key file (readable by this process).',
            },
            {
                key: 'VERTEX_LOCATION',
                value: 'global',
                help: 'Vertex AI region or endpoint (for example global or us-central1). Must be set explicitly.',
            },
            {
                key: 'OPENCODE_MODEL',
                value: model,
                help: 'OpenCode Vertex provider prefix plus model id (for example google-vertex/... or google-vertex-anthropic/...).',
            },
        ];
    }

    return [];
}

export default function OpencodeAuthSetup() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const navigate = useNavigate();

    usePageTitle('OpenCode Auth Setup');

    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [selectedMethod, setSelectedMethod] = useState<number | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [oauthAuthorization, setOauthAuthorization] = useState<OauthAuthorizeResponse | null>(null);
    const [oauthCode, setOauthCode] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const autoOauthRequestRef = useRef<AbortController | null>(null);

    const methods = useMemo(() => {
        if (!status) {
            return [];
        }
        return status.methods.filter((method) => isVisibleAuthMethod(method, status.provider_id));
    }, [status]);
    const authHeaders = useMemo(() => (
        token ? { Authorization: `Bearer ${token}` } : undefined
    ), [token]);

    function getAxiosErrorMessage(err: unknown, fallback: string): string {
        const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : fallback;
        return typeof errorMessage === 'string' ? errorMessage : fallback;
    }

    const selectedAuthMethod = useMemo(() => {
        if (selectedMethod === null) {
            return null;
        }
        return methods.find((method) => method.index === selectedMethod) || null;
    }, [methods, selectedMethod]);
    const isManualCodeStep = oauthAuthorization?.method === 'code';
    const isAutoCodeStep = oauthAuthorization?.method === 'auto';
    const deviceCode = oauthAuthorization ? extractDeviceCode(oauthAuthorization.instructions) : '';
    const isManagedProviderNotice = !isManualCodeStep
        && Boolean(status && (status.provider_id === 'azure-openai' || isManagedGoogleVertexProvider(status.provider_id)));
    const managedEnvExamples = status ? getManagedEnvExamples(status.provider_id, status.model) : [];

    function resetOauthFlowState() {
        if (autoOauthRequestRef.current) {
            autoOauthRequestRef.current.abort();
            autoOauthRequestRef.current = null;
        }
        setOauthAuthorization(null);
        setOauthCode('');
    }

    const loadStatus = useCallback(async () => {
        if (!token) {
            return;
        }

        setIsLoading(true);
        try {
            const response = await axiosInstance.get<StatusResponse>('/api/opencode-auth/status', {
                headers: authHeaders
            });
            const visibleMethods = response.data.methods.filter((method) => isVisibleAuthMethod(method, response.data.provider_id));
            setStatus({
                ...response.data,
                methods: visibleMethods,
            });
            setError('');

            setSelectedMethod((current) => {
                if (current !== null && visibleMethods.some((method) => method.index === current)) {
                    return current;
                }
                return visibleMethods[0]?.index ?? null;
            });
        } catch (err: unknown) {
            setError(getAxiosErrorMessage(err, 'Failed to load opencode auth status'));
        } finally {
            setIsLoading(false);
        }
    }, [authHeaders, token]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        return () => {
            if (autoOauthRequestRef.current) {
                autoOauthRequestRef.current.abort();
                autoOauthRequestRef.current = null;
            }
        };
    }, []);

    const handleSaveApiKey = async () => {
        if (!token || selectedMethod === null) {
            return;
        }

        if (!apiKey) {
            toast.error('API key is required');
            return;
        }

        try {
            await axiosInstance.post('/api/opencode-auth/api',
                { key: apiKey },
                { headers: authHeaders }
            );
            setApiKey('');
            toast.success('API key saved');
            navigate('/opencode-auth/complete', { replace: true });
        } catch (err: unknown) {
            toast.error(getAxiosErrorMessage(err, 'Failed to save API key'));
        }
    };

    const handleStartOAuth = async () => {
        if (!token || selectedMethod === null) {
            return;
        }

        try {
            const response = await axiosInstance.post<OauthAuthorizeResponse>(
                '/api/opencode-auth/oauth/authorize',
                { method: selectedMethod },
                { headers: authHeaders }
            );
            setOauthAuthorization(response.data);
            window.open(response.data.url, '_blank', 'noopener,noreferrer');

            if (response.data.method === 'auto') {
                const controller = new AbortController();
                autoOauthRequestRef.current = controller;
                try {
                    await axiosInstance.post(
                        '/api/opencode-auth/oauth/callback',
                        { method: selectedMethod },
                        { headers: authHeaders, timeout: 120000, signal: controller.signal }
                    );
                    resetOauthFlowState();
                    toast.success('OAuth connected');
                    navigate('/opencode-auth/complete', { replace: true });
                } catch (err: unknown) {
                    if (err instanceof AxiosError && err.code === 'ERR_CANCELED') {
                        return;
                    }
                    toast.error(getAxiosErrorMessage(err, 'Failed to complete OAuth flow'));
                } finally {
                    if (autoOauthRequestRef.current === controller) {
                        autoOauthRequestRef.current = null;
                    }
                }
            }
        } catch (err: unknown) {
            toast.error(getAxiosErrorMessage(err, 'Failed to start OAuth flow'));
        }
    };

    const handleCompleteOAuth = async () => {
        if (!token || selectedMethod === null || !oauthAuthorization) {
            return;
        }

        if (oauthAuthorization.method === 'code' && !oauthCode) {
            toast.error('Authorization code is required');
            return;
        }

        try {
            await axiosInstance.post(
                '/api/opencode-auth/oauth/callback',
                {
                    method: selectedMethod,
                    code: oauthAuthorization.method === 'code' ? oauthCode : undefined,
                },
                { headers: authHeaders }
            );
            resetOauthFlowState();
            toast.success('OAuth connected');
            navigate('/opencode-auth/complete', { replace: true });
        } catch (err: unknown) {
            toast.error(getAxiosErrorMessage(err, 'Failed to complete OAuth flow'));
        }
    };

    const handleManualCodeKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') {
            return;
        }
        event.preventDefault();
        await handleCompleteOAuth();
    };

    if (isLoading) {
        return <div className="opencode-auth-page"><p className="opencode-auth-loading">Checking opencode credentials...</p></div>;
    }

    if (error) {
        return (
            <div className="opencode-auth-page">
                <section className="opencode-auth-panel">
                    <h1>Model Authentication Setup</h1>
                    <p className="opencode-auth-error">{error}</p>
                </section>
            </div>
        );
    }

    if (!status) {
        return null;
    }

    if (isAutoCodeStep) {
        return (
            <div className="opencode-auth-page">
                <section className="opencode-auth-panel opencode-auth-panel-minimal">
                    <header className="opencode-auth-header opencode-auth-header-minimal">
                        <div>
                            <h1>Model Authentication Setup</h1>
                            <p className="opencode-auth-subtitle">Enter this device code in the opened OAuth page.</p>
                        </div>
                    </header>
                    <div className="opencode-auth-oauth-state">
                        <label htmlFor="opencode-device-code">Device Code</label>
                        <input
                            id="opencode-device-code"
                            type="text"
                            value={deviceCode}
                            readOnly
                        />
                        <p className="opencode-auth-waiting">Waiting for OAuth completion...</p>
                        <button type="button" className="opencode-auth-secondary" onClick={resetOauthFlowState}>
                            Go back
                        </button>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div className="opencode-auth-page">
            <section className="opencode-auth-panel">
                <header className="opencode-auth-header">
                    <div>
                        <h1>Model Authentication Setup</h1>
                        <p className="opencode-auth-subtitle">
                            {isManagedProviderNotice ? (
                                <>This model is configured at the service level for <strong>{status.model}</strong></>
                            ) : (
                                <>Configure credentials for <strong>{status.model}</strong></>
                            )}
                        </p>
                        <p className="opencode-auth-meta">Provider: <code>{status.provider_id}</code></p>
                    </div>
                    <div className={`opencode-auth-badge ${status.has_credentials ? 'is-connected' : 'is-required'}`}>
                        {status.has_credentials ? 'Connected' : (isManagedProviderNotice ? 'Admin Managed' : 'Setup Required')}
                    </div>
                </header>

                {isManualCodeStep && (
                    <section className="opencode-auth-section">
                        <h2>Enter Authorization Code</h2>
                        <div className="opencode-auth-card">
                            <label htmlFor="opencode-oauth-code">Authorization Code</label>
                            <input
                                id="opencode-oauth-code"
                                type="text"
                                value={oauthCode}
                                onChange={(event) => setOauthCode(event.target.value)}
                                onKeyDown={handleManualCodeKeyDown}
                                placeholder="Paste authorization code and press Enter"
                            />
                            <button type="button" onClick={handleCompleteOAuth}>
                                Submit code
                            </button>
                            <button type="button" className="opencode-auth-secondary" onClick={resetOauthFlowState}>
                                Go back
                            </button>
                        </div>
                    </section>
                )}

                {!isManualCodeStep && (
                    <section className="opencode-auth-section">
                        <h2>{isManagedProviderNotice ? 'Service Configuration' : 'Choose auth method'}</h2>
                        {methods.length === 0 && !isManagedProviderNotice && (
                            <p className="opencode-auth-error">
                                No auth methods are available for provider <code>{status.provider_id}</code>.
                            </p>
                        )}

                        {isManagedProviderNotice && (
                            <div className="opencode-auth-card opencode-auth-managed-card">
                                <div className="opencode-auth-card-header opencode-auth-managed-header">
                                    <div>
                                        <h3>Managed By Administrator</h3>
                                        <p className="opencode-auth-help">This provider is read-only in TeamCopilot.</p>
                                    </div>
                                </div>
                                <div className="opencode-auth-managed-layout">
                                    <p className="opencode-auth-managed-intro">
                                        {status.provider_id === 'azure-openai' ? (
                                            <>
                                                Azure OpenAI is configured through service environment variables. To update this model,
                                                ask the service administrator to change the values below and restart TeamCopilot.
                                            </>
                                        ) : (
                                            <>
                                                Google Vertex requires GOOGLE_CLOUD_PROJECT, GOOGLE_APPLICATION_CREDENTIALS,
                                                VERTEX_LOCATION, and OPENCODE_MODEL set in server environment variables. Ask the administrator
                                                to update the values below and restart TeamCopilot.
                                            </>
                                        )}
                                    </p>
                                    <div className="opencode-auth-managed-example-block">
                                        <div className="opencode-auth-managed-example-header">
                                            <h4>Required Values</h4>
                                            <p>
                                                {status.provider_id === 'azure-openai'
                                                    ? 'Use your Azure deployment name in OPENCODE_MODEL'
                                                    : 'Use your OpenCode Vertex model id in OPENCODE_MODEL'}
                                            </p>
                                        </div>
                                        <div className="opencode-auth-managed-example-list">
                                            {managedEnvExamples.map((example) => (
                                                <div key={example.key} className="opencode-auth-managed-example-row">
                                                    <div className="opencode-auth-managed-example-copy">
                                                        <code>{example.key}={example.value}</code>
                                                    </div>
                                                    <p>{example.help}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {methods.length > 0 && (
                            <div className="opencode-auth-method-grid">
                                {methods.map((method) => (
                                    <button
                                        key={method.index}
                                        type="button"
                                        className={`opencode-auth-method ${selectedMethod === method.index ? 'is-selected' : ''}`}
                                        onClick={() => {
                                            setSelectedMethod(method.index);
                                            setOauthAuthorization(null);
                                            setOauthCode('');
                                        }}
                                    >
                                        <span className="opencode-auth-method-label">{method.label}</span>
                                        <span className="opencode-auth-method-type">{method.type.toUpperCase()}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {!isManualCodeStep && selectedAuthMethod?.type === 'api' && (
                    <section className="opencode-auth-section">
                        <h2>API key</h2>
                        <p className="opencode-auth-help">Paste the API key for your selected provider and save it.</p>
                        <div className="opencode-auth-card">
                            <label htmlFor="opencode-api-key">Provider API Key</label>
                            <input
                                id="opencode-api-key"
                                type="password"
                                value={apiKey}
                                onChange={(event) => setApiKey(event.target.value)}
                                placeholder="Paste API key"
                            />
                            <button type="button" onClick={handleSaveApiKey}>Save API Key</button>
                        </div>
                    </section>
                )}

                {!isManualCodeStep && selectedAuthMethod?.type === 'oauth' && (
                    <section className="opencode-auth-section">
                        <h2>OAuth</h2>
                        {!isAutoCodeStep && (
                            <p className="opencode-auth-help">Use OAuth login for subscription-backed access (for example Pro/Max plans).</p>
                        )}
                        <div className="opencode-auth-card">
                            {!isAutoCodeStep && (
                                <button type="button" onClick={handleStartOAuth}>Start OAuth</button>
                            )}
                        </div>
                    </section>
                )}
            </section>
        </div>
    );
}

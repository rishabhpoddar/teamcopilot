import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
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

function isVisibleAuthMethod(method: ProviderAuthMethod): boolean {
    if (method.type !== 'oauth') {
        return true;
    }
    return !method.label.toLowerCase().includes('headless');
}

export default function OpencodeAuthSetup() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const navigate = useNavigate();

    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [selectedMethod, setSelectedMethod] = useState<number | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [oauthAuthorization, setOauthAuthorization] = useState<OauthAuthorizeResponse | null>(null);
    const [oauthCode, setOauthCode] = useState('');
    const [isAutoOauthCompleting, setIsAutoOauthCompleting] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const methods = useMemo(() => (status?.methods || []).filter(isVisibleAuthMethod), [status?.methods]);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

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

    function resetOauthFlowState() {
        setOauthAuthorization(null);
        setOauthCode('');
        setIsAutoOauthCompleting(false);
    }

    async function loadStatus() {
        if (!token) {
            return;
        }

        setIsLoading(true);
        try {
            const response = await axiosInstance.get<StatusResponse>('/api/opencode-auth/status', {
                headers: authHeaders
            });
            const visibleMethods = response.data.methods.filter(isVisibleAuthMethod);
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
    }

    useEffect(() => {
        void loadStatus();
    }, [token]);

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
                setIsAutoOauthCompleting(true);
                try {
                    await axiosInstance.post(
                        '/api/opencode-auth/oauth/callback',
                        { method: selectedMethod },
                        { headers: authHeaders, timeout: 120000 }
                    );
                    resetOauthFlowState();
                    toast.success('OAuth connected');
                    navigate('/opencode-auth/complete', { replace: true });
                } catch (err: unknown) {
                    toast.error(getAxiosErrorMessage(err, 'Failed to complete OAuth flow'));
                } finally {
                    setIsAutoOauthCompleting(false);
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

    return (
        <div className="opencode-auth-page">
            <section className="opencode-auth-panel">
                <header className="opencode-auth-header">
                    <div>
                        <h1>Model Authentication Setup</h1>
                        <p className="opencode-auth-subtitle">
                            Configure credentials for <strong>{status.model}</strong>
                        </p>
                        <p className="opencode-auth-meta">Provider: <code>{status.provider_id}</code></p>
                    </div>
                    <div className={`opencode-auth-badge ${status.has_credentials ? 'is-connected' : 'is-required'}`}>
                        {status.has_credentials ? 'Connected' : 'Setup Required'}
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
                    <h2>Choose auth method</h2>
                    {methods.length === 0 && (
                        <p className="opencode-auth-error">
                            No auth methods are available for provider <code>{status.provider_id}</code>.
                        </p>
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
                        <p className="opencode-auth-help">Use OAuth login for subscription-backed access (for example Pro/Max plans).</p>
                        <div className="opencode-auth-card">
                            <button type="button" onClick={handleStartOAuth}>Start OAuth</button>

                            {oauthAuthorization && (
                                <div className="opencode-auth-oauth-state">
                                    <p>{oauthAuthorization.instructions}</p>
                                    <p>
                                        Authorization URL:{' '}
                                        <a href={oauthAuthorization.url} target="_blank" rel="noreferrer">
                                            Open Link
                                        </a>
                                    </p>

                                    {oauthAuthorization.method === 'auto' && isAutoOauthCompleting && (
                                        <p>Waiting for OAuth completion...</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </section>
        </div>
    );
}

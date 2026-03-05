import { useEffect, useMemo, useState } from 'react';
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
    configured_auth_type?: 'api' | 'oauth' | 'wellknown';
    methods: ProviderAuthMethod[];
};

type OauthAuthorizeResponse = {
    url: string;
    method: 'auto' | 'code';
    instructions: string;
};

export default function OpencodeAuthSetup() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const navigate = useNavigate();

    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [selectedMethod, setSelectedMethod] = useState<number | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [oauthAuthorization, setOauthAuthorization] = useState<OauthAuthorizeResponse | null>(null);
    const [oauthCode, setOauthCode] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const methods = status?.methods || [];
    const selectedAuthMethod = useMemo(() => {
        if (selectedMethod === null) {
            return null;
        }
        return methods.find((method) => method.index === selectedMethod) || null;
    }, [methods, selectedMethod]);

    async function loadStatus() {
        if (!token) {
            return;
        }

        setIsLoading(true);
        try {
            const response = await axiosInstance.get<StatusResponse>('/api/opencode-auth/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setStatus(response.data);
            setError('');

            if (response.data.has_credentials) {
                navigate('/', { replace: true });
                return;
            }

            const firstMethod = response.data.methods[0];
            if (firstMethod) {
                setSelectedMethod(firstMethod.index);
            } else {
                setSelectedMethod(null);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to load opencode auth status';
            setError(typeof errorMessage === 'string' ? errorMessage : 'Failed to load opencode auth status');
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
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setApiKey('');
            await loadStatus();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to save API key';
            toast.error(typeof errorMessage === 'string' ? errorMessage : 'Failed to save API key');
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
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setOauthAuthorization(response.data);
            window.open(response.data.url, '_blank', 'noopener,noreferrer');
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to start OAuth flow';
            toast.error(typeof errorMessage === 'string' ? errorMessage : 'Failed to start OAuth flow');
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
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setOauthAuthorization(null);
            setOauthCode('');
            await loadStatus();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to complete OAuth flow';
            toast.error(typeof errorMessage === 'string' ? errorMessage : 'Failed to complete OAuth flow');
        }
    };

    if (isLoading) {
        return <div className="opencode-auth-setup-container"><p>Checking opencode credentials...</p></div>;
    }

    if (error) {
        return (
            <div className="opencode-auth-setup-container">
                <h1>Set Up Model Authentication</h1>
                <p className="opencode-auth-error">{error}</p>
            </div>
        );
    }

    if (!status) {
        return null;
    }

    return (
        <div className="opencode-auth-setup-container">
            <h1>Set Up Model Authentication</h1>
            <p>
                Your configured model is <strong>{status.model}</strong> (<code>{status.provider_id}</code> provider).
            </p>
            <p>You must connect credentials before accessing the dashboard.</p>

            {methods.length === 0 && (
                <p className="opencode-auth-error">
                    No auth methods are available for provider <code>{status.provider_id}</code>.
                </p>
            )}

            {methods.length > 0 && (
                <div className="opencode-auth-methods">
                    <label htmlFor="opencode-auth-method">Auth method</label>
                    <select
                        id="opencode-auth-method"
                        value={selectedMethod ?? ''}
                        onChange={(event) => {
                            setSelectedMethod(event.target.value === '' ? null : Number(event.target.value));
                            setOauthAuthorization(null);
                            setOauthCode('');
                        }}
                    >
                        {methods.map((method) => (
                            <option key={method.index} value={method.index}>
                                {method.label} ({method.type})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {selectedAuthMethod?.type === 'api' && (
                <div className="opencode-auth-card">
                    <label htmlFor="opencode-api-key">API Key</label>
                    <input
                        id="opencode-api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="Paste API key"
                    />
                    <button type="button" onClick={handleSaveApiKey}>Save API Key</button>
                </div>
            )}

            {selectedAuthMethod?.type === 'oauth' && (
                <div className="opencode-auth-card">
                    <button type="button" onClick={handleStartOAuth}>Start OAuth</button>

                    {oauthAuthorization && (
                        <>
                            <p>{oauthAuthorization.instructions}</p>
                            <p>
                                Authorization URL:{' '}
                                <a href={oauthAuthorization.url} target="_blank" rel="noreferrer">
                                    Open Link
                                </a>
                            </p>

                            {oauthAuthorization.method === 'code' && (
                                <>
                                    <label htmlFor="opencode-oauth-code">Authorization Code</label>
                                    <input
                                        id="opencode-oauth-code"
                                        type="text"
                                        value={oauthCode}
                                        onChange={(event) => setOauthCode(event.target.value)}
                                        placeholder="Paste authorization code"
                                    />
                                </>
                            )}

                            <button type="button" onClick={handleCompleteOAuth}>
                                Complete OAuth
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

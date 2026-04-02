import { AxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import { axiosInstance } from '../utils';
import './ProfileSecretsPage.css';

type SecretItem = {
    key: string;
    masked_value: string;
    created_at: number;
    updated_at: number;
};

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

function sortSecrets(secrets: SecretItem[]): SecretItem[] {
    return [...secrets].sort((left, right) => left.key.localeCompare(right.key));
}

export default function ProfileSecretsPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const token = auth.loading ? null : auth.token;
    const isEngineer = !auth.loading && auth.user?.role === 'Engineer';
    const authHeader = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userSecrets, setUserSecrets] = useState<SecretItem[]>([]);
    const [globalSecrets, setGlobalSecrets] = useState<SecretItem[]>([]);
    const [userKey, setUserKey] = useState('');
    const [userValue, setUserValue] = useState('');
    const [globalKey, setGlobalKey] = useState('');
    const [globalValue, setGlobalValue] = useState('');
    const [savingTarget, setSavingTarget] = useState<'user' | 'global' | null>(null);
    const [deletingKey, setDeletingKey] = useState<string | null>(null);

    usePageTitle('Profile Secrets');

    const loadSecrets = useCallback(async () => {
        if (!authHeader) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const userPromise = axiosInstance.get<{ secrets: SecretItem[] }>('/api/users/me/secrets', {
                headers: authHeader
            });
            const globalPromise = isEngineer
                ? axiosInstance.get<{ secrets: SecretItem[] }>('/api/secrets/global', {
                    headers: authHeader
                })
                : Promise.resolve({ data: { secrets: [] as SecretItem[] } });
            const [userResponse, globalResponse] = await Promise.all([userPromise, globalPromise]);
            setUserSecrets(sortSecrets(userResponse.data.secrets || []));
            setGlobalSecrets(sortSecrets(globalResponse.data.secrets || []));
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load secrets'));
        } finally {
            setLoading(false);
        }
    }, [authHeader, isEngineer]);

    useEffect(() => {
        void loadSecrets();
    }, [loadSecrets]);

    const handleSaveSecret = async (scope: 'user' | 'global') => {
        if (!authHeader) return;
        const rawKey = scope === 'user' ? userKey : globalKey;
        const rawValue = scope === 'user' ? userValue : globalValue;
        const normalizedKey = rawKey.trim().toUpperCase();
        if (!normalizedKey || !rawValue) {
            toast.error('Both key and value are required');
            return;
        }

        setSavingTarget(scope);
        try {
            await axiosInstance.put(
                scope === 'user'
                    ? `/api/users/me/secrets/${encodeURIComponent(normalizedKey)}`
                    : `/api/secrets/global/${encodeURIComponent(normalizedKey)}`,
                { value: rawValue },
                { headers: authHeader }
            );
            toast.success(scope === 'user' ? 'Personal secret saved' : 'Global secret saved');
            if (scope === 'user') {
                setUserKey('');
                setUserValue('');
            } else {
                setGlobalKey('');
                setGlobalValue('');
            }
            await loadSecrets();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to save secret'));
        } finally {
            setSavingTarget(null);
        }
    };

    const handleDeleteSecret = async (scope: 'user' | 'global', key: string) => {
        if (!authHeader) return;
        setDeletingKey(`${scope}:${key}`);
        try {
            await axiosInstance.delete(
                scope === 'user'
                    ? `/api/users/me/secrets/${encodeURIComponent(key)}`
                    : `/api/secrets/global/${encodeURIComponent(key)}`,
                { headers: authHeader }
            );
            toast.success(scope === 'user' ? 'Personal secret deleted' : 'Global secret deleted');
            await loadSecrets();
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to delete secret'));
        } finally {
            setDeletingKey(null);
        }
    };

    if (auth.loading) {
        return null;
    }

    return (
        <div className="profile-secrets-page">
            <div className="profile-secrets-card">
                <div className="profile-secrets-header">
                    <div>
                        <h1>Profile Secrets</h1>
                        <p>
                            Workflows and skills can require secret keys. Your personal secrets override engineer-managed global secrets with the same key.
                        </p>
                    </div>
                    <div className="profile-secrets-actions">
                        <button type="button" className="secondary" onClick={() => navigate('/')}>
                            Back Home
                        </button>
                    </div>
                </div>

                {loading && <div className="profile-secrets-state">Loading secrets...</div>}
                {error && <div className="profile-secrets-error">{error}</div>}

                {!loading && !error && (
                    <>
                        <section className="profile-secrets-section">
                            <div className="profile-secrets-section-header">
                                <div>
                                    <h2>My Secrets</h2>
                                    <p>Visible only to you in masked form. Re-saving the same key replaces its value.</p>
                                </div>
                            </div>
                            <div className="profile-secrets-form">
                                <input
                                    type="text"
                                    placeholder="OPENAI_API_KEY"
                                    value={userKey}
                                    onChange={(event) => setUserKey(event.target.value.toUpperCase())}
                                />
                                <input
                                    type="password"
                                    placeholder="Secret value"
                                    value={userValue}
                                    onChange={(event) => setUserValue(event.target.value)}
                                />
                                <button type="button" onClick={() => void handleSaveSecret('user')} disabled={savingTarget !== null}>
                                    {savingTarget === 'user' ? 'Saving...' : 'Save Secret'}
                                </button>
                            </div>
                            <div className="profile-secrets-list">
                                {userSecrets.length === 0 ? (
                                    <div className="profile-secrets-empty">No personal secrets saved yet.</div>
                                ) : (
                                    userSecrets.map((secret) => (
                                        <div key={secret.key} className="profile-secrets-item">
                                            <div>
                                                <div className="profile-secrets-item-key">{secret.key}</div>
                                                <div className="profile-secrets-item-meta">
                                                    {secret.masked_value} · Updated {new Date(secret.updated_at).toLocaleString()}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="danger"
                                                onClick={() => { void handleDeleteSecret('user', secret.key); }}
                                                disabled={deletingKey === `user:${secret.key}`}
                                            >
                                                {deletingKey === `user:${secret.key}` ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>

                        {isEngineer && (
                            <section className="profile-secrets-section">
                                <div className="profile-secrets-section-header">
                                    <div>
                                        <h2>Global Secrets</h2>
                                        <p>Shared fallback secrets managed by engineers. Personal secrets with the same key override these.</p>
                                    </div>
                                </div>
                                <div className="profile-secrets-form">
                                    <input
                                        type="text"
                                        placeholder="SLACK_BOT_TOKEN"
                                        value={globalKey}
                                        onChange={(event) => setGlobalKey(event.target.value.toUpperCase())}
                                    />
                                    <input
                                        type="password"
                                        placeholder="Global secret value"
                                        value={globalValue}
                                        onChange={(event) => setGlobalValue(event.target.value)}
                                    />
                                    <button type="button" onClick={() => void handleSaveSecret('global')} disabled={savingTarget !== null}>
                                        {savingTarget === 'global' ? 'Saving...' : 'Save Global Secret'}
                                    </button>
                                </div>
                                <div className="profile-secrets-list">
                                    {globalSecrets.length === 0 ? (
                                        <div className="profile-secrets-empty">No global secrets saved yet.</div>
                                    ) : (
                                        globalSecrets.map((secret) => (
                                            <div key={secret.key} className="profile-secrets-item">
                                                <div>
                                                    <div className="profile-secrets-item-key">{secret.key}</div>
                                                    <div className="profile-secrets-item-meta">
                                                        {secret.masked_value} · Updated {new Date(secret.updated_at).toLocaleString()}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="danger"
                                                    onClick={() => { void handleDeleteSecret('global', secret.key); }}
                                                    disabled={deletingKey === `global:${secret.key}`}
                                                >
                                                    {deletingKey === `global:${secret.key}` ? 'Deleting...' : 'Delete'}
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

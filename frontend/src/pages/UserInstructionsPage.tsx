import { useCallback, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { axiosInstance } from '../utils';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import './UserInstructionsPage.css';

type UserInstructionsResponse = {
    content: string;
};

function getErrorMessage(err: unknown, fallback: string): string {
    const errorMessage = err instanceof AxiosError
        ? err.response?.data?.message || err.response?.data || err.message
        : fallback;
    return typeof errorMessage === 'string' ? errorMessage : fallback;
}

export default function UserInstructionsPage() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const navigate = useNavigate();
    const isEngineer = !auth.loading && auth.user?.role === 'Engineer';
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    usePageTitle('Global AI Instructions');

    const loadUserInstructions = useCallback(async () => {
        if (!token || !isEngineer) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError('');
        try {
            const response = await axiosInstance.get<UserInstructionsResponse>('/api/chat/user-instructions', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setContent(typeof response.data?.content === 'string' ? response.data.content : '');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to load global AI instructions'));
        } finally {
            setIsLoading(false);
        }
    }, [isEngineer, token]);

    useEffect(() => {
        void loadUserInstructions();
    }, [loadUserInstructions]);

    const handleSave = async () => {
        if (!token || !isEngineer) {
            return;
        }

        setIsSaving(true);
        try {
            await axiosInstance.put<UserInstructionsResponse>('/api/chat/user-instructions', {
                content
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setError('');
            toast.success('Global AI instructions saved');
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to save global AI instructions'));
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (!isLoading && !isSaving) {
                    void handleSave();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, isLoading, isSaving]);

    if (auth.loading) {
        return null;
    }

    if (!isEngineer) {
        return (
            <div className="user-instructions-page">
                <div className="user-instructions-card">
                    <h1>Global AI instructions</h1>
                    <p>Only engineers can modify global AI instructions.</p>
                    <div className="user-instructions-actions">
                        <button type="button" className="secondary" onClick={() => navigate('/?tab=ai')}>
                            Back to AI chat
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="user-instructions-page">
            <div className="user-instructions-card">
                <div className="user-instructions-header">
                    <div>
                        <h1>Global AI instructions</h1>
                        <p>These are saved to <code>USER_INSTRUCTIONS.md</code> at the workspace root and apply immediately.</p>
                    </div>
                    <div className="user-instructions-actions">
                        <button type="button" className="secondary" onClick={() => navigate('/?tab=ai')}>
                            Back to AI chat
                        </button>
                        <button type="button" onClick={() => void handleSave()} disabled={isLoading || isSaving}>
                            {'Save'}
                        </button>
                    </div>
                </div>
                {error ? <div className="user-instructions-error">{error}</div> : null}
                <textarea
                    className="user-instructions-editor"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={isLoading ? 'Loading...' : 'Add custom instructions for the AI agent here. You can tell it about your organisation, target audience, team members, anything on how it should behave, or what it should restrict.'}
                    disabled={isLoading || isSaving}
                    spellCheck={false}
                />
            </div>
        </div>
    );
}

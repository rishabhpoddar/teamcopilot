import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../lib/auth.tsx';
import './Auth.css';

type AuthStep = 'signin' | 'change-password';

export default function Login() {
    const [step, setStep] = useState<AuthStep>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [challengeToken, setChallengeToken] = useState('');
    const [error, setError] = useState('');
    const { login, completePasswordChange, logout } = useAuth();
    const navigate = useNavigate();

    const handleSignIn = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const result = await login(email, password);
            if (result.type === 'password_change_required') {
                setChallengeToken(result.challengeToken);
                setStep('change-password');
                setPassword('');
                return;
            }
            navigate('/');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Sign in failed';
            setError(message);
            setPassword('');
            toast.error(message);
        }
    };

    const handleCompletePasswordChange = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await completePasswordChange(challengeToken, newPassword);
            navigate('/');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Password change failed';
            setError(message);
            toast.error(message);
        }
    };

    return (
        <div className="auth-container">
            <h1>{step === 'signin' ? 'Sign In' : 'Set New Password'}</h1>
            {step === 'signin' ? (
                <form onSubmit={handleSignIn} className="auth-form">
                    {error && <p className="auth-error">{error}</p>}
                    <label htmlFor="email">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoComplete="username"
                        required
                    />
                    <label htmlFor="password">Password</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                    />
                    <button type="submit">Sign In</button>
                </form>
            ) : (
                <form onSubmit={handleCompletePasswordChange} className="auth-form">
                    {error && <p className="auth-error">{error}</p>}
                    <p>You must set a new password before continuing.</p>
                    <label htmlFor="password-change-email">Email</label>
                    <input
                        id="password-change-email"
                        name="email"
                        type="email"
                        value={email}
                        autoComplete="username"
                        readOnly
                        required
                    />
                    <label htmlFor="new-password">New Password (min 8 characters)</label>
                    <input
                        id="new-password"
                        name="new-password"
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                    <button type="submit">Save Password</button>
                    <button
                        type="button"
                        onClick={() => {
                            logout();
                            setStep('signin');
                            setChallengeToken('');
                            setPassword('');
                            setNewPassword('');
                            navigate('/login');
                        }}
                    >
                        Sign Out
                    </button>
                </form>
            )}
            <p className="auth-link">Accounts are created by an administrator via CLI.</p>
        </div>
    );
}

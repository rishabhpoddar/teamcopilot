import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import './Auth.css';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword: password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Reset failed');
            setSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Reset failed');
        }
    };

    if (!token) {
        return (
            <div className="auth-container">
                <h1>Reset Password</h1>
                <p className="auth-error">Missing reset token. Please use the link from the reset command.</p>
                <p className="auth-link"><Link to="/login">Back to Sign In</Link></p>
            </div>
        );
    }

    if (success) {
        return (
            <div className="auth-container">
                <h1>Password Reset</h1>
                <p>Your password has been reset successfully.</p>
                <p className="auth-link"><Link to="/login">Sign In</Link></p>
            </div>
        );
    }

    return (
        <div className="auth-container">
            <h1>Reset Password</h1>
            <form onSubmit={handleSubmit} className="auth-form">
                {error && <p className="auth-error">{error}</p>}
                <label>
                    New Password (min 8 characters)
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        minLength={8}
                    />
                </label>
                <button type="submit">Reset Password</button>
            </form>
            <p className="auth-link"><Link to="/login">Back to Sign In</Link></p>
        </div>
    );
}

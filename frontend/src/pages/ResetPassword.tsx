import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../utils';
import './Auth.css';

function getErrorMessage(err: unknown): string {
    if (err instanceof AxiosError) {
        const responseData = err.response?.data;
        if (typeof responseData?.message === 'string') return responseData.message;
        if (typeof responseData?.error === 'string') return responseData.error;
        if (typeof responseData === 'string') return responseData;
        return err.message;
    }
    return err instanceof Error ? err.message : 'Reset failed';
}

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
            await axiosInstance.post('/api/auth/reset-password', {
                token,
                newPassword: password
            });
            setSuccess(true);
        } catch (err: unknown) {
            const message = getErrorMessage(err);
            setError(message);
            toast.error(message);
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
                <label htmlFor="reset-password">New Password (min 8 characters)</label>
                <input
                    id="reset-password"
                    name="new-password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                />
                <button type="submit">Reset Password</button>
            </form>
            <p className="auth-link"><Link to="/login">Back to Sign In</Link></p>
        </div>
    );
}

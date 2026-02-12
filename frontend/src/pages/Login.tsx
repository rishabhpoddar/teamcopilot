import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import './Auth.css';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await login(email, password);
            navigate('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign in failed');
        }
    };

    return (
        <div className="auth-container">
            <h1>Sign In</h1>
            <form onSubmit={handleSubmit} className="auth-form">
                {error && <p className="auth-error">{error}</p>}
                <label>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                    />
                </label>
                <label>
                    Password
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                    />
                </label>
                <button type="submit">Sign In</button>
            </form>
            <p className="auth-link">
                Don't have an account? <Link to="/signup">Sign Up</Link>
            </p>
        </div>
    );
}

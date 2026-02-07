import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';

export default function Signup() {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'User' | 'Engineer'>('User');
    const [error, setError] = useState('');
    const { signup } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            await signup(email, name, password, role);
            navigate('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign up failed');
        }
    };

    return (
        <div className="auth-container">
            <h1>Sign Up</h1>
            <form onSubmit={handleSubmit} className="auth-form">
                {error && <p className="auth-error">{error}</p>}
                <label>
                    Name
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                    />
                </label>
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
                    Password (min 8 characters)
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        minLength={8}
                    />
                </label>
                <label>
                    Role
                    <select
                        value={role}
                        onChange={e => setRole(e.target.value as 'User' | 'Engineer')}
                        required
                    >
                        <option value="User">User - View and run workflows</option>
                        <option value="Engineer">Engineer - Create, edit, delete, view, and run workflows</option>
                    </select>
                </label>
                <button type="submit">Sign Up</button>
            </form>
            <p className="auth-link">
                Already have an account? <Link to="/login">Sign In</Link>
            </p>
        </div>
    );
}

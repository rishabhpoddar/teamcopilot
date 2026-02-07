/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
    userId: string;
    email: string;
    name: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, name: string, password: string, role: 'User' | 'Engineer') => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const initialToken = localStorage.getItem('token');
    const [token, setToken] = useState<string | null>(initialToken);
    const [loading, setLoading] = useState<boolean>(!!initialToken);

    useEffect(() => {
        if (!token) {
            return;
        }
        fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => {
                if (!res.ok) throw new Error('Unauthorized');
                return res.json();
            })
            .then(data => setUser(data))
            .catch(() => {
                localStorage.removeItem('token');
                setToken(null);
            })
            .finally(() => setLoading(false));
    }, [token]);

    const login = async (email: string, password: string) => {
        const res = await fetch('/api/auth/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sign in failed');
        localStorage.setItem('token', data.token);
        setToken(data.token);
    };

    const signup = async (email: string, name: string, password: string, role: 'User' | 'Engineer') => {
        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sign up failed');
        localStorage.setItem('token', data.token);
        setToken(data.token);
    };

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}

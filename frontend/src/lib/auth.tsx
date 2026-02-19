/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
    userId: string;
    email: string;
    name: string;
    role: 'User' | 'Engineer';
}

type AuthContextType =
    | {
        loading: true;
        login: (email: string, password: string) => Promise<void>;
        signup: (email: string, name: string, password: string, role: 'User' | 'Engineer') => Promise<void>;
        logout: () => void;
    }
    | {
        loading: false;
        user: User | null;
        token: string | null;
        login: (email: string, password: string) => Promise<void>;
        signup: (email: string, name: string, password: string, role: 'User' | 'Engineer') => Promise<void>;
        logout: () => void;
    };

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
        (async () => {
            try {
                const res = await fetch('/api/auth/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (res.status === 401) {
                    localStorage.removeItem('token');
                    setToken(null);
                    setLoading(false);
                    return;
                }

                if (!res.ok) {
                    // Non-401 error: keep loading true
                    return;
                }

                const data = await res.json();
                setUser(data);
                setLoading(false);
            } catch {
                // Network error: keep loading true
            }
        })();
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
        signOut();
        setToken(null);
        setUser(null);
    };

    const value: AuthContextType = loading
        ? { loading: true, login, signup, logout }
        : { loading: false, user, token, login, signup, logout };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}

export function signOut() {
    localStorage.removeItem('token');
}

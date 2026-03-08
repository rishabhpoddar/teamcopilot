/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AxiosError } from 'axios';
import { axiosInstance } from '../utils';

interface User {
    userId: string;
    email: string;
    name: string;
    role: 'User' | 'Engineer';
}

type LoginResult =
    | { type: 'authenticated' }
    | { type: 'password_change_required'; challengeToken: string };

type AuthContextType =
    | {
        loading: true;
        login: (email: string, password: string) => Promise<LoginResult>;
        completePasswordChange: (challengeToken: string, newPassword: string) => Promise<void>;
        logout: () => void;
    }
    | {
        loading: false;
        user: User | null;
        token: string | null;
        login: (email: string, password: string) => Promise<LoginResult>;
        completePasswordChange: (challengeToken: string, newPassword: string) => Promise<void>;
        logout: () => void;
    };

const AuthContext = createContext<AuthContextType | null>(null);

function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof AxiosError) {
        const responseData = err.response?.data;
        if (typeof responseData?.message === 'string') return responseData.message;
        if (typeof responseData?.error === 'string') return responseData.error;
        if (typeof responseData === 'string') return responseData;
        return err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
}

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
                const res = await axiosInstance.get<User>('/api/auth/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setUser(res.data);
                setLoading(false);
            } catch (err: unknown) {
                if (err instanceof AxiosError && err.response?.status === 401) {
                    localStorage.removeItem('token');
                    setToken(null);
                    setLoading(false);
                    return;
                }
                setLoading(true);
            }
        })();
    }, [token]);

    const login = async (email: string, password: string): Promise<LoginResult> => {
        try {
            const res = await axiosInstance.post<{ token?: string; requires_password_change?: boolean; challenge_token?: string }>('/api/auth/signin', {
                email,
                password
            });

            if (res.data.requires_password_change) {
                if (typeof res.data.challenge_token !== 'string' || res.data.challenge_token.length === 0) {
                    throw new Error('Missing challenge token for password change');
                }
                return {
                    type: 'password_change_required',
                    challengeToken: res.data.challenge_token
                };
            }

            if (typeof res.data.token !== 'string' || res.data.token.length === 0) {
                throw new Error('Missing authentication token from sign in response');
            }
            localStorage.setItem('token', res.data.token);
            setToken(res.data.token);

            return { type: 'authenticated' };
        } catch (err: unknown) {
            throw new Error(getErrorMessage(err, 'Sign in failed'));
        }
    };

    const completePasswordChange = async (challengeToken: string, newPassword: string) => {
        try {
            const res = await axiosInstance.post<{ token?: string }>('/api/auth/complete-password-change', {
                challengeToken,
                newPassword
            });

            if (typeof res.data.token !== 'string' || res.data.token.length === 0) {
                throw new Error('Missing authentication token from password change response');
            }
            localStorage.setItem('token', res.data.token);
            setToken(res.data.token);
        } catch (err: unknown) {
            throw new Error(getErrorMessage(err, 'Password change failed'));
        }
    };

    const logout = () => {
        signOut();
        setToken(null);
        setUser(null);
    };

    const value: AuthContextType = loading
        ? { loading: true, login, completePasswordChange, logout }
        : { loading: false, user, token, login, completePasswordChange, logout };

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

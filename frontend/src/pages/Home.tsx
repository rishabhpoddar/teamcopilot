import { useAuth } from '../lib/auth.tsx';

export default function Home() {
    const { user, logout } = useAuth();

    return (
        <div>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h1>FlowPal</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span>{user?.name} ({user?.email})</span>
                    <button onClick={logout}>Sign Out</button>
                </div>
            </header>
            <p>Welcome to FlowPal. Your workspace is ready.</p>
        </div>
    );
}

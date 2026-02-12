import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import WorkflowsSection from '../components/dashboard/WorkflowsSection';
import RunHistorySection from '../components/dashboard/RunHistorySection';
import AIModeSection from '../components/dashboard/AIModeSection';
import './Home.css';

type Tab = 'workflows' | 'history' | 'ai';
const validTabs: Tab[] = ['workflows', 'history', 'ai'];

export default function Home() {
    const { user, logout } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const activeTab: Tab = validTabs.includes(tabParam as Tab) ? (tabParam as Tab) : 'workflows';

    const setActiveTab = (tab: Tab) => {
        setSearchParams({ tab });
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'workflows':
                return <WorkflowsSection />;
            case 'history':
                return <RunHistorySection />;
            case 'ai':
                return <AIModeSection />;
        }
    };

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <h1>LocalTool</h1>
                <div className="dashboard-user">
                    <span>{user?.name} ({user?.email})</span>
                    <button onClick={logout}>Sign Out</button>
                </div>
            </header>

            <nav className="dashboard-tabs">
                <button
                    className={`tab-btn ${activeTab === 'workflows' ? 'active' : ''}`}
                    onClick={() => setActiveTab('workflows')}
                >
                    Workflows
                </button>
                <button
                    className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    Run History
                </button>
                <button
                    className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ai')}
                >
                    AI Mode
                </button>
            </nav>

            <main className="dashboard-content">
                {renderTabContent()}
            </main>
        </div>
    );
}

import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import WorkflowsSection from '../components/dashboard/WorkflowsSection';
import RunHistorySection from '../components/dashboard/RunHistorySection';
import AIModeSection from '../components/dashboard/AIModeSection';
import SkillsSection from '../components/dashboard/SkillsSection';
import './Home.css';

type Tab = 'workflows' | 'history' | 'ai' | 'skills';
const validTabs: Tab[] = ['ai', 'workflows', 'skills', 'history'];
const tabTitles: Record<Tab, string> = {
    ai: 'AI Chat',
    workflows: 'Workflows',
    skills: 'Skills',
    history: 'Run History'
};

export default function Home() {
    const auth = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const activeTab: Tab = validTabs.includes(tabParam as Tab) ? (tabParam as Tab) : 'ai';
    const composeDraft = searchParams.get('draft');
    const composeNewChat = searchParams.get('newChat') === '1';

    usePageTitle(tabTitles[activeTab]);

    if (auth.loading) return null;

    const setActiveTab = (tab: Tab) => {
        setSearchParams({ tab });
    };

    const handleRunWorkflow = (workflowName: string) => {
        setSearchParams({
            tab: 'ai',
            newChat: '1',
            draft: `Run ${workflowName} workflow`
        });
    };

    const clearComposeParams = () => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('newChat');
            next.delete('draft');
            if (!next.get('tab')) {
                next.set('tab', 'ai');
            }
            return next;
        }, { replace: true });
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'workflows':
                return <WorkflowsSection onRunWorkflow={handleRunWorkflow} />;
            case 'history':
                return <RunHistorySection />;
            case 'skills':
                return <SkillsSection />;
            case 'ai':
                return (
                    <AIModeSection
                        initialDraftMessage={composeDraft}
                        forceNewChat={composeNewChat}
                        onDraftHandled={clearComposeParams}
                    />
                );
        }
    };

    return (
        <div className="dashboard">
            <nav className="dashboard-tabs">
                <button
                    className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ai')}
                >
                    AI chat
                </button>
                <button
                    className={`tab-btn ${activeTab === 'workflows' ? 'active' : ''}`}
                    onClick={() => setActiveTab('workflows')}
                >
                    Browse workflows
                </button>
                <button
                    className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
                    onClick={() => setActiveTab('skills')}
                >
                    Browse skills
                </button>
                <button
                    className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    Run history
                </button>
            </nav>

            <main className="dashboard-content">
                {renderTabContent()}
            </main>
        </div>
    );
}

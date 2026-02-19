import type { ChatSession } from '../../../types/chat';

interface SessionSidebarProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (sessionId: string) => void;
    onNewSession: () => void;
    onDeleteSession: (sessionId: string) => void;
    loading: boolean;
}

export default function SessionSidebar({
    sessions,
    activeSessionId,
    onSelectSession,
    onNewSession,
    onDeleteSession,
    loading
}: SessionSidebarProps) {
    const handleDelete = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this session?')) {
            onDeleteSession(sessionId);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    return (
        <div className="chat-sidebar">
            <div className="chat-sidebar-header">
                <h3>Sessions</h3>
                <button
                    className="new-session-btn"
                    onClick={onNewSession}
                    disabled={loading}
                >
                    + New
                </button>
            </div>
            <div className="session-list">
                {sessions.length === 0 ? (
                    <div className="no-sessions">
                        {loading ? 'Loading...' : 'No sessions yet'}
                    </div>
                ) : (
                    sessions.map(session => {
                        const displayTitle = session.title || 'New Chat';
                        return (
                        <div
                            key={session.id}
                            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                            onClick={() => onSelectSession(session.id)}
                        >
                            <div className="session-title" data-full-title={displayTitle}>
                                <span className="session-title-text">{displayTitle}</span>
                                <span className="session-updated-at">
                                    {formatDate(Number(session.updated_at))}
                                </span>
                            </div>
                            <button
                                className="session-delete-btn"
                                onClick={(e) => handleDelete(e, session.id)}
                            >
                                ✕
                            </button>
                        </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

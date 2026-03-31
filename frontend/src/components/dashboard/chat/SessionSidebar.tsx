import type { ChatSession } from '../../../types/chat';

type AttentionDeliveryState = {
    messageId: string;
    delivery: 'notified' | 'seen';
};

interface SessionSidebarProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    attentionStateBySessionId: Record<string, AttentionDeliveryState>;
    onSelectSession: (sessionId: string) => void;
    onNewSession: () => void;
    isOpen: boolean;
    onToggle: () => void;
    // onDeleteSession: (sessionId: string) => void;
    loading: boolean;
}

export default function SessionSidebar({
    sessions,
    activeSessionId,
    attentionStateBySessionId,
    onSelectSession,
    onNewSession,
    isOpen,
    onToggle,
    // onDeleteSession,
    loading
}: SessionSidebarProps) {
    // const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    //     e.stopPropagation();
    //     if (window.confirm('Are you sure you want to delete this session?')) {
    //         onDeleteSession(sessionId);
    //     }
    // };

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
        <aside className={`chat-sidebar ${isOpen ? 'open' : 'collapsed'}`}>
            <div className="chat-sidebar-header">
                <div className="chat-sidebar-header-title">
                    <button
                        type="button"
                        className="chat-sidebar-toggle"
                        onClick={onToggle}
                        aria-label={isOpen ? 'Collapse sessions sidebar' : 'Expand sessions sidebar'}
                        aria-expanded={isOpen}
                    >
                        {isOpen ? '←' : '→'}
                    </button>
                    {isOpen ? <h3>Sessions</h3> : null}
                </div>
                {isOpen ? (
                    <button
                        className="new-session-btn"
                        onClick={onNewSession}
                        disabled={loading}
                    >
                        + New
                    </button>
                ) : null}
            </div>
            <div className="session-list" id="chat-session-list">
                {sessions.length === 0 ? (
                    <div className="no-sessions">
                        {loading ? 'Loading...' : 'No sessions yet'}
                    </div>
                ) : (
                    sessions.map(session => {
                        const displayTitle = session.title || 'New Chat';
                        const attentionState = attentionStateBySessionId[session.id];
                        const attentionMessageId = session.state === 'attention' ? session.latest_message_id : null;
                        const showUnreadIndicator = attentionMessageId !== null
                            && !(attentionState?.messageId === attentionMessageId && attentionState.delivery === 'seen');
                        return (
                        <div
                            key={session.id}
                            className={`session-item ${session.id === activeSessionId ? 'active' : ''} ${showUnreadIndicator ? 'has-unread' : ''}`}
                            onClick={() => onSelectSession(session.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onSelectSession(session.id);
                                }
                            }}
                        >
                            <div className="session-title" data-full-title={displayTitle}>
                                <span className="session-status-icons" aria-hidden="true">
                                    {session.state === 'processing' && <span className="session-running-indicator" />}
                                    {showUnreadIndicator && <span className="session-unread-indicator" />}
                                </span>
                                <span className="session-title-text">{displayTitle}</span>
                                <span className="session-updated-at">
                                    {formatDate(Number(session.updated_at))}
                                </span>
                            </div>
                            {/*
                            <button
                                className="session-delete-btn"
                                onClick={(e) => handleDelete(e, session.id)}
                            >
                                ✕
                            </button>
                            */}
                        </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}

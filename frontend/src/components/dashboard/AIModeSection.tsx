import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import ChatContainer from './chat/ChatContainer';
import './AIModeSection.css';

interface AIModeSectionProps {
    initialDraftMessage: string | null;
    forceNewChat: boolean;
    onDraftHandled: () => void;
}

export default function AIModeSection({ initialDraftMessage, forceNewChat, onDraftHandled }: AIModeSectionProps) {
    const navigate = useNavigate();
    const auth = useAuth();
    const showReconfigureButton = !auth.loading && auth.user?.role === 'Engineer';

    return (
        <div>
            {showReconfigureButton ? (
                <div className="ai-mode-header-actions">
                    <button type="button" className="ai-mode-secondary-btn" onClick={() => navigate('/opencode-auth')}>
                        Reconfigure Opencode Auth
                    </button>
                </div>
            ) : null}
            <ChatContainer
                initialDraftMessage={initialDraftMessage}
                forceNewChat={forceNewChat}
                onDraftHandled={onDraftHandled}
            />
        </div>
    );
}

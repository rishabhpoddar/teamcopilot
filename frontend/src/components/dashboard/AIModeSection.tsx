import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../lib/auth';
import ChatContainer from './chat/ChatContainer';
import './AIModeSection.css';

interface AIModeSectionProps {
    initialDraftMessage: string | null;
    forceNewChat: boolean;
    onDraftHandled: () => void;
    selectedSessionId?: string | null;
}

export default function AIModeSection({ initialDraftMessage, forceNewChat, onDraftHandled, selectedSessionId }: AIModeSectionProps) {
    const navigate = useNavigate();
    const auth = useAuth();
    const showReconfigureButton = !auth.loading && auth.user?.role === 'Engineer';
    const isEngineer = !auth.loading && auth.user?.role === 'Engineer';

    return (
        <div>
            <div className="ai-mode-header-actions">
                <button
                    type="button"
                    className="ai-mode-secondary-btn"
                    onClick={() => {
                        if (!isEngineer) {
                            toast.error('Only engineers can modify global AI instructions');
                            return;
                        }
                        navigate('/user-instructions');
                    }}
                >
                    Modify global AI instructions
                </button>
                {showReconfigureButton ? (
                    <button type="button" className="ai-mode-secondary-btn" onClick={() => navigate('/opencode-auth')}>
                        Reconfigure Opencode Auth
                    </button>
                ) : null}
            </div>
            <ChatContainer
                initialDraftMessage={initialDraftMessage}
                forceNewChat={forceNewChat}
                onDraftHandled={onDraftHandled}
                selectedSessionId={selectedSessionId}
            />
        </div>
    );
}

import ChatContainer from './chat/ChatContainer';

interface AIModeSectionProps {
    initialDraftMessage: string | null;
    forceNewChat: boolean;
    onDraftHandled: () => void;
}

export default function AIModeSection({ initialDraftMessage, forceNewChat, onDraftHandled }: AIModeSectionProps) {
    return (
        <ChatContainer
            initialDraftMessage={initialDraftMessage}
            forceNewChat={forceNewChat}
            onDraftHandled={onDraftHandled}
        />
    );
}

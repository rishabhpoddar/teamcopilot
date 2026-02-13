import { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
    onSend: (content: string) => void;
    onAbort: () => void;
    disabled: boolean;
    isStreaming: boolean;
}

export default function ChatInput({ onSend, onAbort, disabled, isStreaming }: ChatInputProps) {
    const [input, setInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!disabled && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [disabled]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !disabled) {
            onSend(input.trim());
            setInput('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <div className="chat-input-area">
            <form className="chat-input-form" onSubmit={handleSubmit}>
                <textarea
                    ref={textareaRef}
                    className="chat-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message... (Press Enter to send, Shift+Enter for new line)"
                    disabled={disabled || isStreaming}
                    rows={1}
                />
                {isStreaming ? (
                    <button
                        type="button"
                        className="chat-abort-btn"
                        onClick={onAbort}
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        type="submit"
                        className="chat-send-btn"
                        disabled={disabled || !input.trim()}
                    >
                        Send
                    </button>
                )}
            </form>
        </div>
    );
}

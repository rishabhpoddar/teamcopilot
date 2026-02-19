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
    const MAX_VISIBLE_LINES = 4;

    useEffect(() => {
        if (!disabled && !isStreaming && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [disabled, isStreaming]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        textarea.style.height = '0px';

        const computed = window.getComputedStyle(textarea);
        const fontSize = Number.parseFloat(computed.fontSize) || 16;
        const parsedLineHeight = Number.parseFloat(computed.lineHeight);
        const lineHeight = Number.isNaN(parsedLineHeight) ? fontSize * 1.3 : parsedLineHeight;
        const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
        const minHeight = lineHeight + paddingTop + paddingBottom;
        const maxHeight = (lineHeight * MAX_VISIBLE_LINES) + paddingTop + paddingBottom;
        const contentHeight = Math.max(textarea.scrollHeight, minHeight);
        const nextHeight = Math.min(contentHeight, maxHeight);

        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }, [input]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !disabled && !isStreaming) {
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
                    placeholder="Type a message..."
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
            <div className="chat-input-hints">
                Enter to send · Shift+Enter for new line · Esc×2 to stop
            </div>
        </div>
    );
}

import { useState, useRef, useEffect } from 'react';

interface ChatInputSendPayload {
    content: string;
    filePaths: string[];
}

interface ChatInputProps {
    onSend: (payload: ChatInputSendPayload) => void;
    onDraftChange: (content: string) => void;
    fetchFileSuggestions: (query: string) => Promise<string[]>;
    onAbort: () => void;
    disabled: boolean;
    isStreaming: boolean;
    draftMessage: string;
}

export default function ChatInput({
    onSend,
    onDraftChange,
    fetchFileSuggestions,
    onAbort,
    disabled,
    isStreaming,
    draftMessage
}: ChatInputProps) {
    const [input, setInput] = useState('');
    const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestionsVisible, setSuggestionsVisible] = useState(false);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const [suggestionError, setSuggestionError] = useState<string | null>(null);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const suggestionItemRefs = useRef<Array<HTMLDivElement | null>>([]);
    const searchRequestIdRef = useRef(0);
    const lastMentionQueryRef = useRef<string | null>(null);
    const MAX_VISIBLE_LINES = 4;

    useEffect(() => {
        setInput(draftMessage);
    }, [draftMessage]);

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
            onSend({ content: input.trim(), filePaths: selectedFilePaths });
            setInput('');
            setSelectedFilePaths([]);
            setSuggestions([]);
            setSuggestionsVisible(false);
            setSelectedSuggestionIndex(0);
            setSuggestionError(null);
            lastMentionQueryRef.current = null;
            onDraftChange('');
        }
    };

    const extractMentionTokenSet = (value: string): Set<string> => {
        const tokens = new Set<string>();
        const matches = value.matchAll(/(?:^|\s)@([^\s]+)/g);
        for (const match of matches) {
            const token = match[1];
            if (typeof token === 'string' && token.length > 0) {
                tokens.add(token);
            }
        }
        return tokens;
    };

    const getMentionTokenAtCursor = (value: string, cursor: number): { query: string; start: number; end: number } | null => {
        if (cursor <= 0 || cursor > value.length) {
            return null;
        }

        const beforeCursor = value.slice(0, cursor);
        const atIndex = beforeCursor.lastIndexOf('@');
        if (atIndex === -1) {
            return null;
        }

        const charBeforeAt = atIndex === 0 ? '' : beforeCursor[atIndex - 1]!;
        if (atIndex > 0 && !/\s/.test(charBeforeAt)) {
            return null;
        }

        const tokenText = beforeCursor.slice(atIndex + 1);
        if (!tokenText || /\s/.test(tokenText)) {
            return null;
        }

        return {
            query: tokenText,
            start: atIndex,
            end: cursor
        };
    };

    const selectSuggestion = (path: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        const cursor = textarea.selectionStart;
        const mention = getMentionTokenAtCursor(input, cursor);
        if (!mention) {
            return;
        }

        const prefix = input.slice(0, mention.start);
        const suffix = input.slice(mention.end);
        const needsSpace = suffix.length > 0 ? !/^\s/.test(suffix) : true;
        const inserted = `@${path}${needsSpace ? ' ' : ''}`;
        const nextValue = `${prefix}${inserted}${suffix}`;
        const nextCursor = prefix.length + inserted.length;

        setInput(nextValue);
        onDraftChange(nextValue);
        setSelectedFilePaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
        setSuggestionsVisible(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
        setSuggestionError(null);

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.selectionStart = nextCursor;
            textarea.selectionEnd = nextCursor;
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (suggestionsVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedSuggestionIndex((prev) => {
                    if (suggestions.length === 0) return 0;
                    return prev + 1 >= suggestions.length ? 0 : prev + 1;
                });
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedSuggestionIndex((prev) => {
                    if (suggestions.length === 0) return 0;
                    return prev - 1 < 0 ? suggestions.length - 1 : prev - 1;
                });
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = suggestions[selectedSuggestionIndex];
                if (selected) {
                    selectSuggestion(selected);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setSuggestionsVisible(false);
                setSuggestions([]);
                setSelectedSuggestionIndex(0);
                setSuggestionError(null);
                lastMentionQueryRef.current = null;
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
            return;
        }

        const mention = getMentionTokenAtCursor(input, textarea.selectionStart);
        if (!mention) {
            lastMentionQueryRef.current = null;
            setSuggestionsVisible(false);
            setSuggestions([]);
            setSuggestionsLoading(false);
            setSelectedSuggestionIndex(0);
            setSuggestionError(null);
            return;
        }

        if (lastMentionQueryRef.current === mention.query) {
            if (!suggestionsVisible) {
                setSuggestionsVisible(true);
            }
            return;
        }

        lastMentionQueryRef.current = mention.query;
        const currentRequestId = ++searchRequestIdRef.current;
        setSuggestionsVisible(true);
        setSuggestionsLoading(true);
        setSuggestionError(null);

        const timeout = window.setTimeout(async () => {
            try {
                const results = await fetchFileSuggestions(mention.query);
                if (searchRequestIdRef.current !== currentRequestId) {
                    return;
                }
                setSuggestions(results);
                setSuggestionsVisible(true);
                setSelectedSuggestionIndex((prev) => {
                    if (results.length === 0) return 0;
                    return prev >= results.length ? 0 : prev;
                });
            } catch (err: unknown) {
                if (searchRequestIdRef.current !== currentRequestId) {
                    return;
                }
                const message = err instanceof Error ? err.message : 'Failed to fetch file suggestions';
                setSuggestionError(message);
                setSuggestions([]);
                setSuggestionsVisible(true);
                setSelectedSuggestionIndex(0);
            } finally {
                if (searchRequestIdRef.current === currentRequestId) {
                    setSuggestionsLoading(false);
                }
            }
        }, 120);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [fetchFileSuggestions, input, suggestionsVisible]);

    useEffect(() => {
        if (!suggestionsVisible) {
            return;
        }
        const selectedItem = suggestionItemRefs.current[selectedSuggestionIndex];
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedSuggestionIndex, suggestionsVisible, suggestions]);

    return (
        <div className="chat-input-area">
            <div className="chat-input-form-wrap">
                {suggestionsVisible && (
                    <div className="chat-mention-suggestions">
                        {suggestionsLoading ? (
                            <div className="chat-mention-suggestion-empty">Searching files...</div>
                        ) : suggestionError ? (
                            <div className="chat-mention-suggestion-error">{suggestionError}</div>
                        ) : suggestions.length === 0 ? (
                            <div className="chat-mention-suggestion-empty">No matching files</div>
                        ) : (
                            suggestions.map((path, index) => (
                                <div
                                    key={path}
                                    role="option"
                                    aria-selected={index === selectedSuggestionIndex}
                                    className={`chat-mention-suggestion-item ${index === selectedSuggestionIndex ? 'is-selected' : ''}`}
                                    style={index === selectedSuggestionIndex ? { backgroundColor: '#2b2b2b', color: '#f0f0f0' } : undefined}
                                    ref={(element) => {
                                        suggestionItemRefs.current[index] = element;
                                    }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        selectSuggestion(path);
                                    }}
                                >
                                    {path}
                                </div>
                            ))
                        )}
                    </div>
                )}
                <form className="chat-input-form" onSubmit={handleSubmit}>
                <textarea
                    ref={textareaRef}
                    className="chat-input"
                    value={input}
                    onChange={(e) => {
                        const nextValue = e.target.value;
                        setInput(nextValue);
                        const mentionTokens = extractMentionTokenSet(nextValue);
                        setSelectedFilePaths((prev) => prev.filter((filePath) => mentionTokens.has(filePath)));
                        onDraftChange(nextValue);
                    }}
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
            </div>
            <div className="chat-input-hints">
                Enter to send · Shift+Enter for new line · Esc×2 to stop
            </div>
        </div>
    );
}

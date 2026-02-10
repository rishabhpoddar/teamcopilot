import { useState } from 'react';

export default function AIModeSection() {
    const [message, setMessage] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: Implement AI chat functionality
        setMessage('');
    };

    return (
        <div className="ai-mode-container">
            <div className="ai-mode-messages">
                <div className="ai-mode-placeholder">
                    <h3>AI Assistant</h3>
                    <p>Chat with AI to run or create workflows.</p>
                    <p className="ai-mode-hint">Coming soon...</p>
                </div>
            </div>
            <form className="ai-mode-input-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="ai-mode-input"
                    disabled
                />
                <button type="submit" className="ai-mode-send-btn" disabled>
                    Send
                </button>
            </form>
        </div>
    );
}

import type { PermissionRequest } from '../../../types/chat';

interface PermissionPromptProps {
    permission: PermissionRequest;
    submitting: boolean;
    onRespond: (response: "once" | "always" | "reject") => void;
    canAlwaysAllow: boolean;
}

export default function PermissionPrompt({ permission, submitting, onRespond, canAlwaysAllow }: PermissionPromptProps) {
    const hasPatterns = permission.patterns.length > 0;
    const description = hasPatterns
        ? `${permission.permission} permission requested for ${permission.patterns.join(", ")}`
        : `${permission.permission} permission requested`;

    return (
        <div className="permission-prompt">
            <div className="permission-prompt-title">Permission required</div>
            <div className="permission-prompt-text">{description}</div>
            <div className="permission-prompt-actions">
                <button
                    type="button"
                    className="permission-btn allow-once"
                    onClick={() => onRespond("once")}
                    disabled={submitting}
                >
                    Allow once
                </button>
                {canAlwaysAllow && (
                    <button
                        type="button"
                        className="permission-btn allow-always"
                        onClick={() => onRespond("always")}
                        disabled={submitting}
                    >
                        Allow always in this session
                    </button>
                )}
                <button
                    type="button"
                    className="permission-btn deny"
                    onClick={() => onRespond("reject")}
                    disabled={submitting}
                >
                    Deny
                </button>
            </div>
        </div>
    );
}

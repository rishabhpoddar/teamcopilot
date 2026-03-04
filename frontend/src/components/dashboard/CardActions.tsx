import { useState } from 'react';

interface CardActionsProps {
    viewLabel: string;
    onView: () => void;
    showRunAction: boolean;
    runLabel: string;
    canRun: boolean;
    onRunAi?: () => void;
    onRunManual?: () => void;
    deleteVisible: boolean;
    deleteLabel?: string;
    deleting?: boolean;
    onDelete?: () => void;
}

export default function CardActions({
    viewLabel,
    onView,
    showRunAction,
    runLabel,
    canRun,
    onRunAi,
    onRunManual,
    deleteVisible,
    deleteLabel = 'Delete',
    deleting = false,
    onDelete,
}: CardActionsProps) {
    const [showRunModeModal, setShowRunModeModal] = useState(false);
    const supportsRunModes = Boolean(onRunAi && onRunManual);

    return (
        <>
            <div className="workflow-card-actions">
                <button
                    className="workflow-card-run-btn"
                    onClick={onView}
                >
                    {viewLabel}
                </button>

                {showRunAction && (
                    <button
                        className="workflow-card-run-btn"
                        disabled={!canRun}
                        onClick={() => {
                            if (!supportsRunModes) return;
                            setShowRunModeModal(true);
                        }}
                    >
                        {runLabel}
                    </button>
                )}

                {deleteVisible && (
                    <button
                        className="workflow-card-delete-btn"
                        onClick={onDelete}
                        disabled={deleting}
                    >
                        {deleting ? 'Deleting...' : deleteLabel}
                    </button>
                )}
            </div>

            {supportsRunModes && showRunModeModal && (
                <div
                    className="workflow-run-mode-modal-backdrop"
                    onClick={() => setShowRunModeModal(false)}
                >
                    <div
                        className="workflow-run-mode-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="workflow-run-mode-close-btn"
                            aria-label="Close"
                            onClick={() => setShowRunModeModal(false)}
                        />
                        <h4>Choose run mode</h4>
                        <p>Pick how you want to run this workflow.</p>
                        <button
                            type="button"
                            className="workflow-run-mode-ai-btn"
                            onClick={() => {
                                if (!onRunAi) return;
                                onRunAi();
                                setShowRunModeModal(false);
                            }}
                        >
                            AI mode (recommended)
                        </button>
                        <button
                            type="button"
                            className="workflow-run-mode-manual-btn"
                            onClick={() => {
                                if (!onRunManual) return;
                                onRunManual();
                                setShowRunModeModal(false);
                            }}
                        >
                            Manual mode
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

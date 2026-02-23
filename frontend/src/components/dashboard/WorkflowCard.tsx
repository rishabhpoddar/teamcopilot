import { useState } from 'react';
import { toast } from 'react-toastify';
import type { Workflow } from '../../types/workflow';
import { axiosInstance } from '../../utils';
import { AxiosError } from 'axios';

interface WorkflowCardProps extends Workflow {
    userRole: 'User' | 'Engineer';
    currentUserId: string | null;
    token: string;
    onApproved: () => void;
    onDeleted: () => void;
    onRunWorkflow: (workflowName: string) => void;
}

export default function WorkflowCard({
    slug,
    name,
    intent_summary,
    created_by_user_name,
    created_by_user_email,
    created_by_user_id,
    approved_by_user_id,
    userRole,
    currentUserId,
    token,
    onApproved,
    onDeleted,
    onRunWorkflow
}: WorkflowCardProps) {
    const [approving, setApproving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const isApproved = approved_by_user_id !== null;
    const creatorUserMissing = created_by_user_id === null || (!created_by_user_name && !created_by_user_email);
    const canDelete = created_by_user_id === currentUserId || (userRole === 'Engineer' && creatorUserMissing);

    const handleApprove = async () => {
        setApproving(true);
        try {
            await axiosInstance.post(`/api/workflows/${slug}/approve`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Workflow approved successfully');
            onApproved();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data?.message || err.response?.data || err.message
                : 'Failed to approve workflow';
            toast.error(errorMessage);
        } finally {
            setApproving(false);
        }
    };

    const handleDelete = async () => {
        const confirmed = window.confirm(
            `Delete workflow "${name || slug}"?\n\nThis will permanently delete the workflow folder and all past runs. This cannot be undone.`
        );
        if (!confirmed) return;

        setDeleting(true);
        try {
            await axiosInstance.delete(`/api/workflows/${slug}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Workflow deleted successfully');
            onDeleted();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to delete workflow';
            toast.error(errorMessage);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
                <span className={`workflow-approval-badge ${isApproved ? 'approved' : 'pending'}`}>
                    {isApproved ? 'Approved' : 'Pending Approval'}
                </span>
            </div>
            {intent_summary && <p className="workflow-card-description">{intent_summary}</p>}
            <p className="workflow-card-meta">
                Created by: {created_by_user_name ?? created_by_user_email ?? 'Unknown User'}
            </p>

            {!isApproved && (
                <div className="workflow-approval-section">
                    {userRole === 'Engineer' ? (
                        <button
                            className="workflow-approve-btn"
                            onClick={handleApprove}
                            disabled={approving}
                        >
                            {approving ? 'Approving...' : 'Approve Workflow'}
                        </button>
                    ) : (
                        <p className="workflow-approval-message">
                            Ask an engineer to approve this workflow before it can be run.
                        </p>
                    )}
                </div>
            )}

            <div className="workflow-card-actions">
                <button
                    className="workflow-card-run-btn"
                    disabled={!isApproved}
                    onClick={() => onRunWorkflow(name || slug)}
                >
                    Run Workflow
                </button>

                {canDelete && (
                    <button
                        className="workflow-card-delete-btn"
                        onClick={handleDelete}
                        disabled={deleting}
                    >
                        {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                )}
            </div>
        </div>
    );
}

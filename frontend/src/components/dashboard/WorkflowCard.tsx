import { useState } from 'react';
import { toast } from 'react-toastify';
import type { Workflow } from '../../types/workflow';
import { axiosInstance } from '../../utils';
import { AxiosError } from 'axios';

interface WorkflowCardProps extends Workflow {
    userRole: 'User' | 'Engineer';
    token: string;
    onApproved: () => void;
}

export default function WorkflowCard({
    slug,
    name,
    intent_summary,
    approved_by_user_id,
    userRole,
    token,
    onApproved
}: WorkflowCardProps) {
    const [approving, setApproving] = useState(false);
    const isApproved = approved_by_user_id !== null;

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

    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
                <span className={`workflow-approval-badge ${isApproved ? 'approved' : 'pending'}`}>
                    {isApproved ? 'Approved' : 'Pending Approval'}
                </span>
            </div>
            {intent_summary && <p className="workflow-card-description">{intent_summary}</p>}

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

            <button className="workflow-card-run-btn" disabled={!isApproved}>
                Run Workflow
            </button>
        </div>
    );
}

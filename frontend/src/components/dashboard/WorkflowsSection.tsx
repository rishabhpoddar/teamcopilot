import { useEffect, useState, useCallback } from 'react';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import type { Workflow } from '../../types/workflow';
import WorkflowCard from './WorkflowCard';
import './WorkflowsSection.css';

export default function WorkflowsSection() {
    const { token, user } = useAuth();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchWorkflows = useCallback(async () => {
        try {
            const response = await axiosInstance.get('/api/workflows', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setWorkflows(response.data.workflows);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load workflows';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchWorkflows();
    }, [fetchWorkflows]);

    if (loading) {
        return <div className="section-loading">Loading workflows...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    if (workflows.length === 0) {
        return (
            <div className="section-empty">
                <h3>No Workflows Available</h3>
                <p>Create a workflow in your workspace to get started.</p>
                <p className="section-empty-hint">
                    Workflows should be placed in <code>workflows/&lt;slug&gt;/workflow.json</code>
                </p>
            </div>
        );
    }

    return (
        <div className="workflows-grid">
            {workflows.map((workflow) => (
                <WorkflowCard
                    key={workflow.slug}
                    {...workflow}
                    userRole={user?.role ?? 'User'}
                    token={token ?? ''}
                    onApproved={fetchWorkflows}
                />
            ))}
        </div>
    );
}

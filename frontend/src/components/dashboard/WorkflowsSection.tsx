import { useEffect, useState, useCallback } from 'react';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import type { Workflow } from '../../types/workflow';
import WorkflowCard from './WorkflowCard';
import './WorkflowsSection.css';
import { AxiosError } from 'axios';

export default function WorkflowsSection() {
    const auth = useAuth();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const token = auth.loading ? null : auth.token;
    const user = auth.loading ? null : auth.user;

    const fetchWorkflows = useCallback(async () => {
        if (!token) return;
        try {
            const response = await axiosInstance.get('/api/workflows', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setWorkflows(response.data.workflows);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to load workflows';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchWorkflows();
    }, [fetchWorkflows]);

    if (auth.loading) return null;

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

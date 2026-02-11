import { useEffect, useState } from 'react';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import { Workflow } from '../../types/workflow';
import WorkflowCard from './WorkflowCard';
import './WorkflowsSection.css';

export default function WorkflowsSection() {
    const { token } = useAuth();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchWorkflows = async () => {
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
        };

        fetchWorkflows();
    }, [token]);

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
                />
            ))}
        </div>
    );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import type { WorkflowRun, WorkflowRunStatus } from '../../types/workflow';
import './RunHistorySection.css';
import { AxiosError } from 'axios';

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

function formatDuration(startedAt: number, completedAt: number | null): string {
    if (!completedAt) return 'Running...';
    const durationMs = completedAt - startedAt;
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
}

function StatusBadge({ status }: { status: WorkflowRunStatus }) {
    return <span className={`status-badge status-${status}`}>{status}</span>;
}

export default function RunHistorySection() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [runs, setRuns] = useState<WorkflowRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const token = auth.loading ? null : auth.token;

    useEffect(() => {
        if (!token) return;

        const fetchRuns = async () => {
            try {
                const response = await axiosInstance.get('/api/workflows/runs', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setRuns(response.data.runs);
            } catch (err: unknown) {
                const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to load run history';
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };

        fetchRuns();
    }, [token]);

    if (auth.loading) return null;

    if (loading) {
        return <div className="section-loading">Loading run history...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    if (runs.length === 0) {
        return (
            <div className="section-empty">
                <h3>No Run History</h3>
                <p>Workflow runs will appear here once you start running workflows.</p>
            </div>
        );
    }

    return (
        <div className="run-history-table-container">
            <table className="run-history-table">
                <thead>
                    <tr>
                        <th>Workflow</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>User</th>
                    </tr>
                </thead>
                <tbody>
                    {runs.map((run) => (
                        <tr
                            key={run.id}
                            className="run-history-row"
                            onClick={() => navigate(`/runs/${encodeURIComponent(run.id)}`)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    navigate(`/runs/${encodeURIComponent(run.id)}`);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                        >
                            <td className="workflow-name-cell">{run.workflow_slug}</td>
                            <td><StatusBadge status={run.status} /></td>
                            <td>{formatDate(run.started_at)}</td>
                            <td>{formatDuration(run.started_at, run.completed_at)}</td>
                            <td>{run.user.name}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

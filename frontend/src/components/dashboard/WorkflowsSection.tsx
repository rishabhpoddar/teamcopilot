import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { axiosInstance } from '../../utils';
import { useAuth } from '../../lib/auth';
import type { Workflow } from '../../types/workflow';
import WorkflowCard from './WorkflowCard';
import './WorkflowsSection.css';
import { AxiosError } from 'axios';

interface WorkflowsSectionProps {
    onRunWorkflow: (workflowName: string) => void;
}

type ApprovalFilter = 'all' | 'approved' | 'pending';
type OwnershipFilter = 'everyone' | 'mine';

function normalizeWorkflowSearchValue(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function matchesWorkflowTitleSearch(title: string, query: string): boolean {
    const normalizedQuery = normalizeWorkflowSearchValue(query);
    if (!normalizedQuery) return true;

    const normalizedTitle = normalizeWorkflowSearchValue(title);
    if (!normalizedTitle) return false;

    const parts = normalizedTitle.split('-').filter(Boolean);
    const candidates = new Set<string>();

    candidates.add(normalizedTitle);

    for (let i = 0; i < parts.length; i += 1) {
        candidates.add(parts[i]);
        candidates.add(parts.slice(i).join('-'));
    }

    for (const candidate of candidates) {
        if (candidate.startsWith(normalizedQuery)) {
            return true;
        }
    }

    return false;
}

export default function WorkflowsSection({ onRunWorkflow }: WorkflowsSectionProps) {
    const navigate = useNavigate();
    const auth = useAuth();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
    const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('everyone');
    const [searchQuery, setSearchQuery] = useState('');

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

    const filteredWorkflows = workflows.filter((workflow) => {
        const matchesApproval = approvalFilter === 'all'
            ? true
            : approvalFilter === 'approved'
                ? workflow.approved_by_user_id !== null
                : workflow.approved_by_user_id === null;

        const matchesOwnership = ownershipFilter === 'everyone'
            ? true
            : workflow.created_by_user_id === user?.userId;

        const matchesSearch = matchesWorkflowTitleSearch(workflow.name || workflow.slug, searchQuery);

        return matchesApproval && matchesOwnership && matchesSearch;
    });

    return (
        <div className="workflows-section-content">
            <div className="workflow-filters">
                <div className="workflow-filters-title">
                    <span className="workflow-filters-heading">Filters</span>
                    <span className="workflow-filters-count">
                        {filteredWorkflows.length} / {workflows.length} shown
                    </span>
                </div>

                <div className="workflow-filter-group">
                    <label htmlFor="workflow-approval-filter">Approval</label>
                    <div className="workflow-filter-select-wrap">
                        <select
                            id="workflow-approval-filter"
                            value={approvalFilter}
                            onChange={(e) => setApprovalFilter(e.target.value as ApprovalFilter)}
                        >
                            <option value="all">All</option>
                            <option value="approved">Approved</option>
                            <option value="pending">Pending approval</option>
                        </select>
                    </div>
                </div>

                <div className="workflow-filter-group">
                    <label htmlFor="workflow-ownership-filter">Scope</label>
                    <div className="workflow-filter-select-wrap">
                        <select
                            id="workflow-ownership-filter"
                            value={ownershipFilter}
                            onChange={(e) => setOwnershipFilter(e.target.value as OwnershipFilter)}
                        >
                            <option value="everyone">Everyone&apos;s</option>
                            <option value="mine">Only mine</option>
                        </select>
                    </div>
                </div>

                <div className="workflow-filter-group workflow-filter-group-search">
                    <label htmlFor="workflow-title-search">Search title</label>
                    <div className="workflow-filter-search-wrap">
                        <input
                            id="workflow-title-search"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search workflow title..."
                        />
                    </div>
                </div>
            </div>

            {filteredWorkflows.length === 0 ? (
                <div className="section-empty">
                    <h3>No Workflows Match Filters</h3>
                    <p>Try changing the approval or ownership filters.</p>
                </div>
            ) : (
                <div className="workflows-grid">
                    {filteredWorkflows.map((workflow) => (
                        <WorkflowCard
                            key={workflow.slug}
                            {...workflow}
                            userRole={user?.role ?? 'User'}
                            currentUserId={user?.userId ?? null}
                            token={token ?? ''}
                            onApproved={fetchWorkflows}
                            onDeleted={fetchWorkflows}
                            onRunWorkflow={onRunWorkflow}
                            onOpenWorkflow={(slug) => navigate(`/workflows/${encodeURIComponent(slug)}`)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

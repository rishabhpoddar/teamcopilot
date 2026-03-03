import { useCallback, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { useAuth } from '../../lib/auth';
import { axiosInstance } from '../../utils';
import type { Skill } from '../../types/skill';
import SkillCard from './SkillCard';
import './WorkflowsSection.css';

type ApprovalFilter = 'all' | 'approved' | 'pending';
type OwnershipFilter = 'everyone' | 'mine';

function normalizeSkillSearchValue(value: string): string {
    return value.toLowerCase().trim();
}

export default function SkillsSection() {
    const auth = useAuth();
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
    const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('everyone');
    const [searchQuery, setSearchQuery] = useState('');

    const token = auth.loading ? null : auth.token;
    const user = auth.loading ? null : auth.user;

    const fetchSkills = useCallback(async () => {
        if (!token) return;
        try {
            const response = await axiosInstance.get('/api/skills', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSkills(response.data.skills);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load skills';
            setError(String(errorMessage));
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        void fetchSkills();
    }, [fetchSkills]);

    if (auth.loading) return null;

    if (loading) {
        return <div className="section-loading">Loading skills...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    if (skills.length === 0) {
        return (
            <div className="section-empty">
                <h3>No Skills Available</h3>
                <p>Skills appear here once they are created under the workspace custom skills folder.</p>
            </div>
        );
    }

    const normalizedQuery = normalizeSkillSearchValue(searchQuery);
    const filteredSkills = skills.filter((skill) => {
        const matchesApproval = approvalFilter === 'all'
            ? true
            : approvalFilter === 'approved'
                ? skill.is_approved
                : !skill.is_approved;

        const matchesOwnership = ownershipFilter === 'everyone'
            ? true
            : skill.created_by_user_id === user?.userId;

        const matchesSearch = normalizedQuery.length === 0
            ? true
            : normalizeSkillSearchValue(skill.name).includes(normalizedQuery)
                || normalizeSkillSearchValue(skill.slug).includes(normalizedQuery)
                || normalizeSkillSearchValue(skill.description).includes(normalizedQuery);

        return matchesApproval && matchesOwnership && matchesSearch;
    });

    return (
        <div className="workflows-section-content">
            <div className="workflow-filters">
                <div className="workflow-filters-title">
                    <span className="workflow-filters-heading">Filters</span>
                    <span className="workflow-filters-count">
                        {filteredSkills.length} / {skills.length} shown
                    </span>
                </div>

                <div className="workflow-filter-group">
                    <label htmlFor="skill-approval-filter">Approval</label>
                    <div className="workflow-filter-select-wrap">
                        <select
                            id="skill-approval-filter"
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
                    <label htmlFor="skill-ownership-filter">Scope</label>
                    <div className="workflow-filter-select-wrap">
                        <select
                            id="skill-ownership-filter"
                            value={ownershipFilter}
                            onChange={(e) => setOwnershipFilter(e.target.value as OwnershipFilter)}
                        >
                            <option value="everyone">Everyone&apos;s</option>
                            <option value="mine">Only mine</option>
                        </select>
                    </div>
                </div>

                <div className="workflow-filter-group workflow-filter-group-search">
                    <label htmlFor="skill-search">Search</label>
                    <div className="workflow-filter-search-wrap">
                        <input
                            id="skill-search"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search skill name, slug, description..."
                        />
                    </div>
                </div>
            </div>

            {filteredSkills.length === 0 ? (
                <div className="section-empty">
                    <h3>No Skills Match Filters</h3>
                    <p>Try changing the approval or ownership filters.</p>
                </div>
            ) : (
                <div className="workflows-grid">
                    {filteredSkills.map((skill) => (
                        <SkillCard
                            key={skill.slug}
                            {...skill}
                            currentUserId={user?.userId ?? null}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

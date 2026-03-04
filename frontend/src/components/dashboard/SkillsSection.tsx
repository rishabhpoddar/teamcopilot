import { useCallback, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
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

function toSlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

export default function SkillsSection() {
    const navigate = useNavigate();
    const auth = useAuth();
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
    const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('everyone');
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateSkillForm, setShowCreateSkillForm] = useState(false);
    const [newSkillNameOrSlug, setNewSkillNameOrSlug] = useState('');
    const [creatingSkill, setCreatingSkill] = useState(false);

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

    const handleCreateSkill = async () => {
        if (!token) return;
        setCreatingSkill(true);
        try {
            await axiosInstance.post('/api/skills', {
                name: newSkillNameOrSlug.trim(),
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Skill created');
            navigate(`/skills/${encodeURIComponent(newSkillNameOrSlug.trim())}`);
            setShowCreateSkillForm(false);
            setNewSkillNameOrSlug('');
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to create skill';
            toast.error(String(errorMessage));
        } finally {
            setCreatingSkill(false);
        }
    };

    if (auth.loading) return null;

    if (loading) {
        return <div className="section-loading">Loading skills...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
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
                || normalizeSkillSearchValue(skill.slug).includes(normalizedQuery);

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
                <button
                    type="button"
                    className="skills-create-btn"
                    onClick={() => {
                        setShowCreateSkillForm(true);
                    }}
                >
                    Create Skill
                </button>

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
                            placeholder="Search skill name or slug..."
                        />
                    </div>
                </div>
            </div>

            {showCreateSkillForm && (
                <div
                    className="workflow-run-mode-modal-backdrop"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                        if (creatingSkill) return;
                        setShowCreateSkillForm(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key !== 'Escape') return;
                        if (creatingSkill) return;
                        setShowCreateSkillForm(false);
                    }}
                >
                    <div className="workflow-run-mode-modal skills-create-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="workflow-run-mode-close-btn"
                            aria-label="Close create skill modal"
                            onClick={() => {
                                if (creatingSkill) return;
                                setShowCreateSkillForm(false);
                            }}
                        />
                        <h4>Create Skill</h4>
                        <p>Name and slug are the same value.</p>
                        <div className="skills-create-modal-field">
                            <label htmlFor="new-skill-name">Skill name / slug</label>
                            <input
                                id="new-skill-name"
                                type="text"
                                value={newSkillNameOrSlug}
                                placeholder="my-slack-alerts-skill"
                                onChange={(e) => setNewSkillNameOrSlug(toSlug(e.target.value))}
                            />
                        </div>
                        <div className="skills-create-modal-actions">
                            <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                    if (creatingSkill) return;
                                    setShowCreateSkillForm(false);
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="skills-create-submit-btn"
                                onClick={() => { void handleCreateSkill(); }}
                                disabled={creatingSkill || newSkillNameOrSlug.trim().length === 0}
                            >
                                {creatingSkill ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {filteredSkills.length === 0 ? (
                <div className="section-empty">
                    <h3>{skills.length === 0 ? 'No Skills Available' : 'No Skills Match Filters'}</h3>
                    <p>
                        {skills.length === 0
                            ? 'Use the Create Skill button to add your first skill.'
                            : 'Try changing the approval or ownership filters.'}
                    </p>
                </div>
            ) : (
                <div className="workflows-grid">
                    {filteredSkills.map((skill) => (
                        <SkillCard
                            key={skill.slug}
                            {...skill}
                            userRole={user?.role ?? 'User'}
                            currentUserId={user?.userId ?? null}
                            token={token ?? ''}
                            onDeleted={() => {
                                setLoading(true);
                                void fetchSkills();
                            }}
                            onUpdated={() => {
                                setLoading(true);
                                void fetchSkills();
                            }}
                            onOpenSkill={(skillSlug) => navigate(`/skills/${encodeURIComponent(skillSlug)}`)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

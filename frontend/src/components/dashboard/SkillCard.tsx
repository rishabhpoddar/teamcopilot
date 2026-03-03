import type { Skill } from '../../types/skill';

interface SkillCardProps extends Skill {
    currentUserId: string | null;
}

export default function SkillCard({
    slug,
    name,
    description,
    created_by_user_id,
    created_by_user_name,
    created_by_user_email,
    is_approved,
    access_permission_mode,
    allowed_user_count,
    currentUserId,
}: SkillCardProps) {
    const isOwnedByCurrentUser = created_by_user_id === currentUserId;

    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name || slug}</h3>
                <span className={`workflow-approval-badge ${is_approved ? 'approved' : 'pending'}`}>
                    {is_approved ? 'Approved' : 'Pending Approval'}
                </span>
            </div>
            <p className="workflow-card-meta">Slug: {slug}</p>
            {description && <p className="workflow-card-description">{description}</p>}
            <p className="workflow-card-meta">
                Created by: {created_by_user_name ?? created_by_user_email ?? 'Unknown User'}{isOwnedByCurrentUser ? ' (you)' : ''}
            </p>
            <p className="workflow-card-meta">
                Access: {access_permission_mode === 'restricted' ? `Restricted (${allowed_user_count} allowed)` : access_permission_mode}
            </p>
        </div>
    );
}

import type { Skill } from '../../types/skill';
import UnifiedCard from './UnifiedCard';

interface SkillCardProps extends Skill {
    userRole: 'User' | 'Engineer';
    currentUserId: string | null;
    token: string;
    onDeleted: () => void;
    onUpdated: () => void;
    onOpenSkill: (slug: string) => void;
}

export default function SkillCard(props: SkillCardProps) {
    return (
        <UnifiedCard
            kind="skill"
            slug={props.slug}
            name={props.name}
            description={props.description}
            created_by_user_id={props.created_by_user_id}
            created_by_user_name={props.created_by_user_name}
            created_by_user_email={props.created_by_user_email}
            approved_by_user_id={props.approved_by_user_id}
            is_approved={props.is_approved}
            permission_mode={props.permission_mode}
            can_current_user_manage_permissions={props.can_current_user_manage_permissions}
            allowed_user_count={props.allowed_user_count}
            is_locked_due_to_missing_users={props.is_locked_due_to_missing_users}
            can_run={false}
            userRole={props.userRole}
            currentUserId={props.currentUserId}
            token={props.token}
            viewLabel="View Skills"
            showRunAction={false}
            runLabel="Run Workflow"
            onUpdated={props.onUpdated}
            onDeleted={props.onDeleted}
            onOpen={props.onOpenSkill}
        />
    );
}

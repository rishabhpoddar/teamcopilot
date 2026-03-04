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
            can_view={props.can_view}
            can_edit={props.can_edit}
            permission_mode={props.permission_mode}
            is_locked_due_to_missing_users={props.is_locked_due_to_missing_users}
            can_run={false}
            userRole={props.userRole}
            currentUserId={props.currentUserId}
            token={props.token}
            viewLabel="View Skill"
            showRunAction={false}
            runLabel="Run Workflow"
            onUpdated={props.onUpdated}
            onDeleted={props.onDeleted}
            onOpen={props.onOpenSkill}
        />
    );
}

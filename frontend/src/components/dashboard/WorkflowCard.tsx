import type { Workflow } from '../../types/workflow';
import UnifiedCard from './UnifiedCard';

interface WorkflowCardProps extends Workflow {
    userRole: 'User' | 'Engineer';
    currentUserId: string | null;
    token: string;
    onApproved: () => void;
    onDeleted: () => void;
    onRunWorkflow: (workflowName: string) => void;
    onRunWorkflowManual: (workflowSlug: string) => void;
    onOpenWorkflow: (slug: string) => void;
}

export default function WorkflowCard(props: WorkflowCardProps) {
    return (
        <UnifiedCard
            kind="workflow"
            slug={props.slug}
            name={props.name}
            description={props.intent_summary}
            created_by_user_id={props.created_by_user_id}
            created_by_user_name={props.created_by_user_name}
            created_by_user_email={props.created_by_user_email}
            approved_by_user_id={props.approved_by_user_id}
            is_approved={props.is_approved}
            can_view={props.can_view}
            can_edit={props.can_edit}
            permission_mode={props.permission_mode}
            is_locked_due_to_missing_users={props.is_locked_due_to_missing_users}
            can_run={props.is_approved && props.can_edit}
            userRole={props.userRole}
            currentUserId={props.currentUserId}
            token={props.token}
            viewLabel="View Code"
            showRunAction={true}
            runLabel="Run Workflow"
            onUpdated={props.onApproved}
            onDeleted={props.onDeleted}
            onOpen={props.onOpenWorkflow}
            onRunAi={() => props.onRunWorkflow(props.name || props.slug)}
            onRunManual={() => props.onRunWorkflowManual(props.slug)}
        />
    );
}

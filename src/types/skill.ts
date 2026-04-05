import type { PermissionMode } from "./permissions";

export interface SkillSummary {
    slug: string;
    name: string;
    description: string;
    created_by_user_id: string | null;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    is_approved: boolean;
    can_view: boolean;
    can_edit: boolean;
    permission_mode: PermissionMode;
    is_locked_due_to_missing_users: boolean;
    required_secrets: string[];
    missing_required_secrets: string[];
}

export type Skill = SkillSummary;

export interface SkillRuntimeContent {
    slug: string;
    path: string;
    content: string;
    required_secrets: string[];
}

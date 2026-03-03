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
    permission_mode: PermissionMode;
    can_current_user_use: boolean;
    can_current_user_manage_permissions: boolean;
    allowed_user_count: number;
    is_locked_due_to_missing_users: boolean;
}

export type Skill = SkillSummary;

export type SkillAccessPermissionMode = "restricted" | "everyone";

export interface SkillAccessPermissionsRestricted {
    mode: "restricted";
    allowed_user_ids: string[];
}

export interface SkillAccessPermissionsEveryone {
    mode: "everyone";
}

export type SkillAccessPermissions = SkillAccessPermissionsRestricted | SkillAccessPermissionsEveryone;

export interface SkillSummary {
    slug: string;
    name: string;
    description: string;
    created_by_user_id: string | null;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    is_approved: boolean;
    access_permission_mode: SkillAccessPermissionMode;
    allowed_user_count: number;
    can_current_user_use_skill: boolean;
    can_current_user_manage_access_permissions: boolean;
    is_access_locked_due_to_missing_users: boolean;
}

export type Skill = SkillSummary;

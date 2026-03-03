export type SkillAccessPermissionMode = "restricted";

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
}

export type Skill = SkillSummary;

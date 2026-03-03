export type PermissionMode = "restricted" | "everyone";

export interface PermissionsRestricted {
    mode: "restricted";
    allowed_user_ids: string[];
}

export interface PermissionsEveryone {
    mode: "everyone";
}

export type Permissions = PermissionsRestricted | PermissionsEveryone;

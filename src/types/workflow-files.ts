export interface WorkflowEditorAccessResponse {
    can_view: true;
    can_edit: boolean;
    workflow_status: "approved" | "pending";
    is_owner: boolean;
    is_engineer: boolean;
}

export interface WorkflowFileNode {
    path: string;
    name: string;
    kind: "file" | "directory";
    size_bytes: number | null;
    modified_at_ms: number;
    has_children: boolean | null;
    is_hidden: boolean;
    is_symlink: boolean;
    readable: boolean;
}

export interface WorkflowFileTreeResponse {
    path: string;
    entries: WorkflowFileNode[];
}

export interface WorkflowFileContentTextResponse {
    path: string;
    name: string;
    kind: "text";
    encoding: "utf-8";
    content: string;
    etag: string;
    is_dotenv: boolean;
    is_redacted: boolean;
    size_bytes: number;
    modified_at_ms: number;
}

export interface WorkflowFileContentBinaryResponse {
    path: string;
    name: string;
    kind: "binary";
    etag: string;
    size_bytes: number;
    modified_at_ms: number;
    message: string;
}

export type WorkflowFileContentResponse = WorkflowFileContentTextResponse | WorkflowFileContentBinaryResponse;

export interface WorkflowFileSaveRequest {
    path: string;
    content: string;
    base_etag: string;
    preserve_masked_dotenv_values?: boolean;
}

export interface WorkflowFileSaveResponse {
    path: string;
    etag: string;
    modified_at_ms: number;
    size_bytes: number;
    is_redacted: boolean;
    saved: true;
}

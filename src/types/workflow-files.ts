export interface EditorAccessResponse {
    can_view: boolean;
    can_edit: boolean;
    editor_status: "approved" | "pending";
}

export interface FileNode {
    path: string;
    name: string;
    kind: "file" | "directory";
    size_bytes: number | null;
    modified_at_ms: number;
    has_children: boolean | null;
    readable: boolean;
}

export interface FileTreeResponse {
    path: string;
    entries: FileNode[];
}

export interface FileContentTextResponse {
    path: string;
    name: string;
    kind: "text";
    encoding: "utf-8";
    content: string;
    etag: string;
    size_bytes: number;
    modified_at_ms: number;
}

export interface FileContentBinaryResponse {
    path: string;
    name: string;
    kind: "binary";
    etag: string;
    size_bytes: number;
    modified_at_ms: number;
    message: string;
}

export type FileContentResponse = FileContentTextResponse | FileContentBinaryResponse;

export interface FileSaveRequest {
    path: string;
    content: string;
    base_etag: string;
}

export interface FileSaveResponse {
    path: string;
    etag: string;
    modified_at_ms: number;
    size_bytes: number;
}

import fs from "fs";
import path from "path";
import type { WorkflowApprovalDiffResponse, WorkflowSnapshot, WorkflowSnapshotFile } from "../types/workflow";
import { buildApprovalDiffResponse, looksBinary, sha256 } from "./approval-snapshot-common";
import { getWorkspaceDirFromEnv } from "./workspace-sync";

type BaselineContentKind = "text" | "binary" | "missing";

interface SessionTrackedFileBaseline {
    relative_path: string;
    existed_at_baseline: boolean;
    content_kind: BaselineContentKind;
    text_content: string | null;
    binary_content: Uint8Array | null;
    size_bytes: number | null;
    content_sha256: string | null;
}

interface FileBaselineCapture {
    existed_at_baseline: boolean;
    content_kind: BaselineContentKind;
    text_content: string | null;
    binary_content: Buffer | null;
    size_bytes: number | null;
    content_sha256: string | null;
}

export function normalizeWorkspaceRelativePath(rawPath: string): string {
    const normalized = path.posix.normalize(rawPath.split("\\").join("/").trim());
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
        throw {
            status: 400,
            message: "file path must be a workspace-relative path"
        };
    }
    return normalized;
}

function getAbsoluteWorkspacePath(relativePath: string): string {
    const workspaceDir = getWorkspaceDirFromEnv();
    const absolutePath = path.resolve(workspaceDir, relativePath);
    const relativeCheck = path.relative(workspaceDir, absolutePath);
    if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
        throw {
            status: 400,
            message: "file path must stay inside workspace"
        };
    }
    return absolutePath;
}

export function captureCurrentFileBaseline(relativePath: string): FileBaselineCapture {
    const absolutePath = getAbsoluteWorkspacePath(relativePath);
    if (!fs.existsSync(absolutePath)) {
        return {
            existed_at_baseline: false,
            content_kind: "missing",
            text_content: null,
            binary_content: null,
            size_bytes: null,
            content_sha256: null,
        };
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
        throw {
            status: 400,
            message: `Tracked path '${relativePath}' is not a regular file`
        };
    }

    const bytes = fs.readFileSync(absolutePath);
    const isBinary = looksBinary(bytes);
    return {
        existed_at_baseline: true,
        content_kind: isBinary ? "binary" : "text",
        text_content: isBinary ? null : bytes.toString("utf-8"),
        binary_content: isBinary ? bytes : null,
        size_bytes: bytes.length,
        content_sha256: sha256(bytes),
    };
}

function toSnapshotFile(relativePath: string, baseline: FileBaselineCapture | SessionTrackedFileBaseline): WorkflowSnapshotFile | null {
    if (!baseline.existed_at_baseline || baseline.content_kind === "missing") {
        return null;
    }

    return {
        relative_path: relativePath,
        content_kind: baseline.content_kind === "binary" ? "binary" : "text",
        text_content: baseline.content_kind === "text" ? baseline.text_content : null,
        binary_content: baseline.content_kind === "binary"
            ? (baseline.binary_content ? Buffer.from(baseline.binary_content) : null)
            : null,
        size_bytes: baseline.size_bytes ?? 0,
        content_sha256: baseline.content_sha256 ?? "",
    };
}

function readCurrentSnapshotFile(relativePath: string): WorkflowSnapshotFile | null {
    const capture = captureCurrentFileBaseline(relativePath);
    return toSnapshotFile(relativePath, capture);
}

function buildSnapshotFromFiles(files: WorkflowSnapshotFile[]): WorkflowSnapshot {
    return {
        workflow_slug: "chat-session",
        snapshot_hash: "",
        file_count: files.length,
        files,
    };
}

export function buildChatSessionFileDiffResponse(baselines: SessionTrackedFileBaseline[]): WorkflowApprovalDiffResponse {
    if (baselines.length === 0) {
        return {
            has_previous_snapshot: false,
            summary: {
                added: 0,
                modified: 0,
                deleted: 0,
                text_files: 0,
                binary_files: 0,
            },
            files: [],
            ignored_rules: [],
        };
    }

    const previousFiles: WorkflowSnapshotFile[] = [];
    const currentFiles: WorkflowSnapshotFile[] = [];

    for (const baseline of baselines) {
        const previous = toSnapshotFile(baseline.relative_path, baseline);
        if (previous) {
            previousFiles.push(previous);
        }

        const current = readCurrentSnapshotFile(baseline.relative_path);
        if (current) {
            currentFiles.push(current);
        }
    }

    return buildApprovalDiffResponse(
        buildSnapshotFromFiles(previousFiles),
        buildSnapshotFromFiles(currentFiles)
    );
}

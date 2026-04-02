import crypto from "crypto";
import fs from "fs";
import path from "path";
import prisma from "../prisma/client";
import type {
    SnapshotContentKind,
    WorkflowApprovalDiffFile,
    WorkflowApprovalDiffResponse,
    WorkflowSnapshot,
    WorkflowSnapshotApprovalState,
    WorkflowSnapshotFile,
} from "../types/workflow";
import { ResourceKind } from "./permission-common";

const MAX_INLINE_DIFF_FILE_BYTES = 200 * 1024;
const MAX_PATCH_LINES_PER_FILE = 5000;

interface CollectSnapshotOptions {
    slug: string;
    resource_label: string;
    root_path: string;
}

interface ResourceSnapshotConfig {
    resource_kind: ResourceKind;
    slug: string;
    resource_label: string;
    root_path: string;
    ensure_resource_exists: () => Promise<void>;
}

function capitalize(value: string): string {
    if (!value) {
        return value;
    }
    return value[0].toUpperCase() + value.slice(1);
}

export function sha256(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function looksBinary(buffer: Buffer): boolean {
    if (buffer.length === 0) return false;
    const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
    for (let i = 0; i < sample.length; i += 1) {
        if (sample[i] === 0) {
            return true;
        }
    }
    return false;
}

export function shouldIgnoreRelativePath(
    relativePath: string,
    options?: { allowTopLevelAgentsDirectory?: boolean }
): boolean {
    if (!relativePath) {
        return false;
    }
    const segments = relativePath.split("/").filter(Boolean);
    const allowTopLevelAgentsDirectory = options?.allowTopLevelAgentsDirectory === true;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const isTopLevelAgentsDirectory = allowTopLevelAgentsDirectory && index === 0 && segment === ".agents";
        if (segment.startsWith(".") && !isTopLevelAgentsDirectory) {
            return true;
        }
        if (segment === "__pycache__") {
            return true;
        }
        if (segment === "data") {
            return true;
        }
    }
    return false;
}

function assertNoSymlink(absolutePath: string, resourceLabel: string): void {
    const lstat = fs.lstatSync(absolutePath);
    if (lstat.isSymbolicLink()) {
        throw {
            status: 400,
            message: `${capitalize(resourceLabel)} approval snapshot does not support symlinks`
        };
    }
}

function resolveSnapshotRootPath(rootPath: string, slug: string, resourceLabel: string): string {
    if (!fs.existsSync(rootPath)) {
        throw {
            status: 404,
            message: `${capitalize(resourceLabel)} not found for slug: ${slug}`
        };
    }

    const lstat = fs.lstatSync(rootPath);
    if (lstat.isSymbolicLink()) {
        const resolvedPath = fs.realpathSync(rootPath);
        if (!fs.statSync(resolvedPath).isDirectory()) {
            throw {
                status: 400,
                message: `${capitalize(resourceLabel)} path is not a directory`
            };
        }
        return resolvedPath;
    }

    if (!lstat.isDirectory()) {
        throw {
            status: 400,
            message: `${capitalize(resourceLabel)} path is not a directory`
        };
    }

    return rootPath;
}

function ensureDirectoryExists(absoluteDir: string): void {
    fs.mkdirSync(absoluteDir, { recursive: true });
}

function collectFilesRecursive(
    absoluteDir: string,
    relativeDir: string,
    out: WorkflowSnapshotFile[],
    resourceLabel: string,
): void {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (shouldIgnoreRelativePath(rel)) {
            continue;
        }
        const abs = path.join(absoluteDir, entry.name);
        assertNoSymlink(abs, resourceLabel);

        if (entry.isDirectory()) {
            collectFilesRecursive(abs, rel, out, resourceLabel);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }

        const bytes = fs.readFileSync(abs);
        const binary = looksBinary(bytes);
        out.push({
            relative_path: rel,
            content_kind: binary ? "binary" : "text",
            text_content: binary ? null : bytes.toString("utf-8"),
            binary_content: binary ? bytes : null,
            size_bytes: bytes.length,
            content_sha256: sha256(bytes),
        });
    }
}

function collectCurrentNonIgnoredFilePaths(
    absoluteDir: string,
    relativeDir: string,
    out: string[],
    resourceLabel: string,
): void {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (shouldIgnoreRelativePath(rel)) {
            continue;
        }
        const abs = path.join(absoluteDir, entry.name);
        assertNoSymlink(abs, resourceLabel);

        if (entry.isDirectory()) {
            collectCurrentNonIgnoredFilePaths(abs, rel, out, resourceLabel);
            continue;
        }
        if (entry.isFile()) {
            out.push(rel);
        }
    }
}

function pruneEmptyNonIgnoredDirectories(
    rootPath: string,
    absoluteDir: string,
    relativeDir: string,
    resourceLabel: string,
): void {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
        const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (shouldIgnoreRelativePath(rel)) {
            continue;
        }
        const abs = path.join(absoluteDir, entry.name);
        assertNoSymlink(abs, resourceLabel);
        if (entry.isDirectory()) {
            pruneEmptyNonIgnoredDirectories(rootPath, abs, rel, resourceLabel);
        }
    }

    if (absoluteDir === rootPath) {
        return;
    }
    const remaining = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => !shouldIgnoreRelativePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name));
    if (remaining.length === 0) {
        fs.rmdirSync(absoluteDir);
    }
}

function computeSnapshotHash(files: WorkflowSnapshotFile[]): string {
    const hash = crypto.createHash("sha256");
    const sorted = files
        .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
    for (const file of sorted) {
        hash.update(file.relative_path);
        hash.update("\0");
        hash.update(file.content_kind);
        hash.update("\0");
        hash.update(file.content_sha256);
        hash.update("\n");
    }
    return hash.digest("hex");
}

export function collectCurrentResourceSnapshot(options: CollectSnapshotOptions): WorkflowSnapshot {
    const { root_path: configuredRootPath, slug, resource_label: resourceLabel } = options;
    const rootPath = resolveSnapshotRootPath(configuredRootPath, slug, resourceLabel);

    const files: WorkflowSnapshotFile[] = [];
    collectFilesRecursive(rootPath, "", files, resourceLabel);
    files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));

    return {
        workflow_slug: slug,
        files,
        file_count: files.length,
        snapshot_hash: computeSnapshotHash(files),
    };
}

type SnapshotWriteTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function writeApprovedSnapshotInTx(
    tx: SnapshotWriteTx,
    resourceKind: ResourceKind,
    slug: string,
    snapshot: WorkflowSnapshot,
    now: bigint
): Promise<void> {
    const existingSnapshot = await tx.resource_approved_snapshots.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug
            }
        },
        select: { resource_slug: true }
    });

    if (existingSnapshot) {
        await tx.resource_approved_snapshot_files.deleteMany({
            where: {
                resource_kind: resourceKind,
                resource_slug: slug
            }
        });
        await tx.resource_approved_snapshots.update({
            where: {
                resource_kind_resource_slug: {
                    resource_kind: resourceKind,
                    resource_slug: slug
                }
            },
            data: {
                file_count: snapshot.file_count,
                updated_at: now,
            }
        });
    } else {
        await tx.resource_approved_snapshots.create({
            data: {
                resource_kind: resourceKind,
                resource_slug: slug,
                file_count: snapshot.file_count,
                created_at: now,
                updated_at: now,
            }
        });
    }

    if (snapshot.files.length > 0) {
        await tx.resource_approved_snapshot_files.createMany({
            data: snapshot.files.map((file) => ({
                resource_kind: resourceKind,
                resource_slug: slug,
                relative_path: file.relative_path,
                content_kind: file.content_kind,
                text_content: file.text_content,
                binary_content: file.binary_content ? new Uint8Array(file.binary_content) : null,
                size_bytes: file.size_bytes,
                content_sha256: file.content_sha256,
            }))
        });
    }
}

export async function loadApprovedSnapshotFromDb(
    resourceKind: ResourceKind,
    slug: string,
): Promise<WorkflowSnapshot | null> {
    const row = await prisma.resource_approved_snapshots.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: resourceKind,
                resource_slug: slug
            }
        },
        include: { files: true }
    });
    if (!row) {
        return null;
    }

    const files: WorkflowSnapshotFile[] = row.files
        .filter((file) => !shouldIgnoreRelativePath(file.relative_path))
        .map((file): WorkflowSnapshotFile => ({
            relative_path: file.relative_path,
            content_kind: (file.content_kind === "binary" ? "binary" : "text") as SnapshotContentKind,
            text_content: file.text_content,
            binary_content: file.binary_content ? Buffer.from(file.binary_content) : null,
            size_bytes: file.size_bytes,
            content_sha256: file.content_sha256,
        }))
        .sort((a, b) => a.relative_path.localeCompare(b.relative_path));

    return {
        workflow_slug: slug,
        snapshot_hash: computeSnapshotHash(files),
        file_count: files.length,
        files,
    };
}

export async function approveResourceWithSnapshot(
    config: ResourceSnapshotConfig,
    userId: string
): Promise<{ approved_by_user_id: string; snapshot_hash: string; snapshot_file_count: number }> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
        throw {
            status: 404,
            message: "User not found"
        };
    }
    if (user.role !== "Engineer") {
        throw {
            status: 403,
            message: `Only Engineers can approve ${config.resource_label}s`
        };
    }

    await config.ensure_resource_exists();
    const snapshot = collectCurrentResourceSnapshot(config);
    const now = Date.now();

    await prisma.$transaction(async (tx) => {
        const nowBigInt = BigInt(now);
        await writeApprovedSnapshotInTx(tx, config.resource_kind, config.slug, snapshot, nowBigInt);

        await tx.resource_metadata.update({
            where: {
                resource_kind_resource_slug: {
                    resource_kind: config.resource_kind,
                    resource_slug: config.slug
                }
            },
            data: {
                approved_by_user_id: userId,
                updated_at: nowBigInt,
            }
        });
    });

    return {
        approved_by_user_id: userId,
        snapshot_hash: snapshot.snapshot_hash,
        snapshot_file_count: snapshot.file_count,
    };
}

export async function restoreResourceToApprovedSnapshot(
    config: ResourceSnapshotConfig,
    userId: string,
): Promise<{ restored_file_count: number; snapshot_hash: string }> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
        throw {
            status: 404,
            message: "User not found"
        };
    }
    if (user.role !== "Engineer") {
        throw {
            status: 403,
            message: `Only Engineers can restore ${config.resource_label}s from approved snapshots`
        };
    }

    await config.ensure_resource_exists();
    const snapshot = await loadApprovedSnapshotFromDb(config.resource_kind, config.slug);
    if (!snapshot) {
        throw {
            status: 409,
            message: "No approved snapshot exists to restore"
        };
    }

    const rootPath = resolveSnapshotRootPath(config.root_path, config.slug, config.resource_label);

    const currentPaths: string[] = [];
    collectCurrentNonIgnoredFilePaths(rootPath, "", currentPaths, config.resource_label);
    const snapshotPathSet = new Set(snapshot.files.map((file) => file.relative_path));

    for (const currentPath of currentPaths) {
        if (snapshotPathSet.has(currentPath)) {
            continue;
        }
        const absolutePath = path.join(rootPath, currentPath);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            fs.unlinkSync(absolutePath);
        }
    }

    for (const file of snapshot.files) {
        const absolutePath = path.join(rootPath, file.relative_path);
        ensureDirectoryExists(path.dirname(absolutePath));
        const bytes = file.content_kind === "binary"
            ? (file.binary_content ?? Buffer.alloc(0))
            : Buffer.from(file.text_content ?? "", "utf-8");
        fs.writeFileSync(absolutePath, bytes);
    }

    pruneEmptyNonIgnoredDirectories(rootPath, rootPath, "", config.resource_label);

    return {
        restored_file_count: snapshot.file_count,
        snapshot_hash: computeSnapshotHash(snapshot.files),
    };
}

export async function getResourceSnapshotApprovalState(config: ResourceSnapshotConfig): Promise<WorkflowSnapshotApprovalState> {
    const approvedSnapshot = await loadApprovedSnapshotFromDb(config.resource_kind, config.slug);
    if (!approvedSnapshot) {
        return {
            has_approved_snapshot: false,
            is_current_code_approved: false,
        };
    }

    const currentSnapshot = collectCurrentResourceSnapshot(config);
    const approvedSnapshotHash = computeSnapshotHash(approvedSnapshot.files);
    const matches = approvedSnapshotHash === currentSnapshot.snapshot_hash;

    return {
        has_approved_snapshot: true,
        is_current_code_approved: matches,
    };
}

function splitLines(input: string): string[] {
    return input.split(/\r?\n/);
}

type DiffOp =
    | { kind: "context"; line: string }
    | { kind: "add"; line: string }
    | { kind: "remove"; line: string };

function diffLinesSimple(oldText: string, newText: string): DiffOp[] {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const ops: DiffOp[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            ops.push({ kind: "context", line: a[i] });
            i += 1;
            j += 1;
            continue;
        }
        if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ kind: "remove", line: a[i] });
            i += 1;
        } else {
            ops.push({ kind: "add", line: b[j] });
            j += 1;
        }
    }
    while (i < a.length) {
        ops.push({ kind: "remove", line: a[i] });
        i += 1;
    }
    while (j < b.length) {
        ops.push({ kind: "add", line: b[j] });
        j += 1;
    }
    return ops;
}

function buildPatchLines(oldText: string, newText: string): { patch_lines: string[]; is_truncated: boolean } {
    const ops = diffLinesSimple(oldText, newText);
    const lines: string[] = ["@@"];
    for (const op of ops) {
        if (op.kind === "context") {
            lines.push(` ${op.line}`);
        } else if (op.kind === "add") {
            lines.push(`+${op.line}`);
        } else {
            lines.push(`-${op.line}`);
        }
        if (lines.length >= MAX_PATCH_LINES_PER_FILE) {
            return { patch_lines: lines, is_truncated: true };
        }
    }
    return { patch_lines: lines, is_truncated: false };
}

function toFileMap(snapshot: WorkflowSnapshot | null): Map<string, WorkflowSnapshotFile> {
    return new Map((snapshot?.files ?? []).map((file) => [file.relative_path, file]));
}

function diffFileToResponse(pathKey: string, previousFile: WorkflowSnapshotFile | null, currentFile: WorkflowSnapshotFile | null): WorkflowApprovalDiffFile {
    if (previousFile === null && currentFile !== null) {
        if (currentFile.content_kind === "text") {
            const canInline = currentFile.size_bytes <= MAX_INLINE_DIFF_FILE_BYTES && currentFile.text_content !== null;
            if (canInline) {
                const currentText = currentFile.text_content as string;
                const patch = buildPatchLines("", currentText);
                return {
                    path: pathKey,
                    status: "added",
                    kind: "text",
                    old_size_bytes: null,
                    new_size_bytes: currentFile.size_bytes,
                    patch_lines: patch.patch_lines,
                    is_truncated: patch.is_truncated,
                    message: null,
                };
            }
            return {
                path: pathKey,
                status: "added",
                kind: "text",
                old_size_bytes: null,
                new_size_bytes: currentFile.size_bytes,
                patch_lines: null,
                is_truncated: false,
                message: "Diff omitted for large file",
            };
        }
        return {
            path: pathKey,
            status: "added",
            kind: "binary",
            old_size_bytes: null,
            new_size_bytes: currentFile.size_bytes,
            patch_lines: null,
            is_truncated: false,
            message: "Binary file added",
        };
    }

    if (previousFile !== null && currentFile === null) {
        if (previousFile.content_kind === "text") {
            const canInline = previousFile.size_bytes <= MAX_INLINE_DIFF_FILE_BYTES && previousFile.text_content !== null;
            if (canInline) {
                const previousText = previousFile.text_content as string;
                const patch = buildPatchLines(previousText, "");
                return {
                    path: pathKey,
                    status: "deleted",
                    kind: "text",
                    old_size_bytes: previousFile.size_bytes,
                    new_size_bytes: null,
                    patch_lines: patch.patch_lines,
                    is_truncated: patch.is_truncated,
                    message: null,
                };
            }
            return {
                path: pathKey,
                status: "deleted",
                kind: "text",
                old_size_bytes: previousFile.size_bytes,
                new_size_bytes: null,
                patch_lines: null,
                is_truncated: false,
                message: "Diff omitted for large file",
            };
        }
        return {
            path: pathKey,
            status: "deleted",
            kind: "binary",
            old_size_bytes: previousFile.size_bytes,
            new_size_bytes: null,
            patch_lines: null,
            is_truncated: false,
            message: "Binary file deleted",
        };
    }

    const before = previousFile!;
    const after = currentFile!;
    if (before.content_kind === "text" && after.content_kind === "text") {
        const canInline = before.size_bytes <= MAX_INLINE_DIFF_FILE_BYTES
            && after.size_bytes <= MAX_INLINE_DIFF_FILE_BYTES
            && before.text_content !== null
            && after.text_content !== null;

        if (canInline) {
            const beforeText = before.text_content as string;
            const afterText = after.text_content as string;
            const patch = buildPatchLines(beforeText, afterText);
            return {
                path: pathKey,
                status: "modified",
                kind: "text",
                old_size_bytes: before.size_bytes,
                new_size_bytes: after.size_bytes,
                patch_lines: patch.patch_lines,
                is_truncated: patch.is_truncated,
                message: null,
            };
        }
        return {
            path: pathKey,
            status: "modified",
            kind: "text",
            old_size_bytes: before.size_bytes,
            new_size_bytes: after.size_bytes,
            patch_lines: null,
            is_truncated: false,
            message: "Diff omitted for large file",
        };
    }

    return {
        path: pathKey,
        status: "modified",
        kind: "binary",
        old_size_bytes: before.size_bytes,
        new_size_bytes: after.size_bytes,
        patch_lines: null,
        is_truncated: false,
        message: before.content_kind !== after.content_kind ? "File type changed" : "Binary file modified",
    };
}

export function buildApprovalDiffResponse(previous: WorkflowSnapshot | null, current: WorkflowSnapshot): WorkflowApprovalDiffResponse {
    const previousMap = toFileMap(previous);
    const currentMap = toFileMap(current);
    const allPaths = Array.from(new Set([...previousMap.keys(), ...currentMap.keys()])).sort((a, b) => a.localeCompare(b));

    const files: WorkflowApprovalDiffFile[] = [];
    const summary = {
        added: 0,
        modified: 0,
        deleted: 0,
        text_files: 0,
        binary_files: 0,
    };

    for (const pathKey of allPaths) {
        const before = previousMap.get(pathKey) ?? null;
        const after = currentMap.get(pathKey) ?? null;
        if (before && after && before.content_sha256 === after.content_sha256 && before.content_kind === after.content_kind) {
            continue;
        }
        const diffFile = diffFileToResponse(pathKey, before, after);
        files.push(diffFile);
        if (diffFile.status === "added") summary.added += 1;
        if (diffFile.status === "modified") summary.modified += 1;
        if (diffFile.status === "deleted") summary.deleted += 1;
        if (diffFile.kind === "text") summary.text_files += 1;
        else summary.binary_files += 1;
    }

    return {
        has_previous_snapshot: previous !== null,
        summary,
        files,
        ignored_rules: [],
    };
}

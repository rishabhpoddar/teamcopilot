import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
    WorkflowFileContentBinaryResponse,
    WorkflowFileContentResponse,
    WorkflowFileContentTextResponse,
    WorkflowFileNode,
    WorkflowFileSaveRequest,
    WorkflowFileSaveResponse,
    WorkflowFileTreeResponse,
} from "../types/workflow-files";
import { getWorkflowPath } from "./workflow";
import { isLikelySensitiveKey, maskValue, sanitizeStringContent } from "./redact";

type ParsedEnvAssignment =
    | {
        kind: "assignment";
        prefix: string;
        key: string;
        separator: string;
        quote: '"' | "'" | null;
        value: string;
        suffix: string;
    }
    | { kind: "other" };

function toEtag(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeRelativePath(rawPath: string, allowEmpty: boolean): string {
    const input = rawPath.trim();
    if (!input) {
        if (allowEmpty) {
            return "";
        }
        throw {
            status: 400,
            message: "path is required"
        };
    }
    if (input.includes("\0")) {
        throw {
            status: 400,
            message: "path contains invalid characters"
        };
    }

    const withForwardSlashes = input.replace(/\\/g, "/");
    if (withForwardSlashes.startsWith("/")) {
        throw {
            status: 400,
            message: "path must be relative to the workflow root"
        };
    }

    const normalized = path.posix.normalize(withForwardSlashes);
    if (normalized === "." && allowEmpty) {
        return "";
    }
    if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
        throw {
            status: 400,
            message: "path escapes the workflow root"
        };
    }
    return normalized;
}

function resolveWorkflowTarget(slug: string, relativePath: string): string {
    const root = getWorkflowPath(slug);
    const absolute = path.resolve(root, relativePath);
    const normalizedRoot = path.resolve(root);
    if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${path.sep}`)) {
        throw {
            status: 400,
            message: "path escapes the workflow root"
        };
    }
    return absolute;
}

function assertWorkflowRootNotSymlink(slug: string): void {
    const workflowRoot = getWorkflowPath(slug);
    if (!fs.existsSync(workflowRoot)) {
        return;
    }
    const rootLstat = fs.lstatSync(workflowRoot);
    if (rootLstat.isSymbolicLink()) {
        throw {
            status: 400,
            message: "Workflow editor does not support symlinked workflow directories"
        };
    }
}

function assertRealPathWithinWorkflowRoot(slug: string, absolutePath: string): void {
    const realRoot = fs.realpathSync(getWorkflowPath(slug));
    const realTarget = fs.realpathSync(absolutePath);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
        throw {
            status: 400,
            message: "path escapes the workflow root"
        };
    }
}

function assertNoSymlinkInAncestors(slug: string, absolutePath: string): void {
    const root = path.resolve(getWorkflowPath(slug));
    let current = path.resolve(absolutePath);
    while (true) {
        const lstat = fs.lstatSync(current);
        if (lstat.isSymbolicLink()) {
            throw {
                status: 400,
                message: "Workflow editor does not support symlinks"
            };
        }
        if (current === root) {
            return;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw {
                status: 400,
                message: "path escapes the workflow root"
            };
        }
        current = parent;
    }
}

function assertExistingPathIsSafe(slug: string, absolutePath: string): void {
    assertWorkflowRootNotSymlink(slug);
    assertRealPathWithinWorkflowRoot(slug, absolutePath);
    assertNoSymlinkInAncestors(slug, absolutePath);
}

function assertParentDirectoryIsSafeForCreate(slug: string, parentAbsolutePath: string): void {
    assertWorkflowRootNotSymlink(slug);
    assertRealPathWithinWorkflowRoot(slug, parentAbsolutePath);
    assertNoSymlinkInAncestors(slug, parentAbsolutePath);
}

function assertValidName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") {
        throw {
            status: 400,
            message: "Invalid file or folder name"
        };
    }
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
        throw {
            status: 400,
            message: "Invalid file or folder name"
        };
    }
}

function findClosingQuoteIndex(input: string, quote: '"' | "'"): number {
    for (let i = 1; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === "\\") {
            i += 1;
            continue;
        }
        if (ch === quote) {
            return i;
        }
    }
    return -1;
}

function toFileNode(parentRelativePath: string, name: string, absolutePath: string): WorkflowFileNode {
    const lstat = fs.lstatSync(absolutePath);
    const isDir = lstat.isDirectory();
    let readable = true;

    try {
        fs.accessSync(absolutePath, fs.constants.R_OK);
    } catch {
        readable = false;
    }

    let hasChildren: boolean | null = null;
    if (isDir && readable) {
        try {
            hasChildren = fs.readdirSync(absolutePath).length > 0;
        } catch {
            hasChildren = false;
            readable = false;
        }
    }

    const relativePath = parentRelativePath ? `${parentRelativePath}/${name}` : name;

    return {
        path: relativePath,
        name,
        kind: isDir ? "directory" : "file",
        size_bytes: isDir ? null : lstat.size,
        modified_at_ms: lstat.mtimeMs,
        has_children: isDir ? (hasChildren ?? false) : null,
        readable,
    };
}

function compareNodes(a: WorkflowFileNode, b: WorkflowFileNode): number {
    if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
}

function looksBinary(buffer: Buffer): boolean {
    if (buffer.length === 0) {
        return false;
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
    for (let i = 0; i < sample.length; i += 1) {
        if (sample[i] === 0) {
            return true;
        }
    }
    return false;
}

function parseEnvAssignmentLine(line: string): ParsedEnvAssignment {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/);
    if (!match) {
        return { kind: "other" };
    }
    const [, prefix, key, separator, remainder] = match;

    if (remainder.startsWith('"')) {
        const closeIdx = findClosingQuoteIndex(remainder, '"');
        if (closeIdx === -1) {
            return { kind: "other" };
        }
        return {
            kind: "assignment",
            prefix,
            key,
            separator,
            quote: '"',
            value: remainder.slice(1, closeIdx),
            suffix: remainder.slice(closeIdx + 1),
        };
    }
    if (remainder.startsWith("'")) {
        const closeIdx = findClosingQuoteIndex(remainder, "'");
        if (closeIdx === -1) {
            return { kind: "other" };
        }
        return {
            kind: "assignment",
            prefix,
            key,
            separator,
            quote: "'",
            value: remainder.slice(1, closeIdx),
            suffix: remainder.slice(closeIdx + 1),
        };
    }

    const commentStart = remainder.search(/\s#/);
    if (commentStart === -1) {
        return {
            kind: "assignment",
            prefix,
            key,
            separator,
            quote: null,
            value: remainder.trim(),
            suffix: "",
        };
    }

    const valuePart = remainder.slice(0, commentStart).trim();
    const suffix = remainder.slice(commentStart);
    return {
        kind: "assignment",
        prefix,
        key,
        separator,
        quote: null,
        value: valuePart,
        suffix,
    };
}

function serializeEnvAssignment(parsed: Exclude<ParsedEnvAssignment, { kind: "other" }>): string {
    if (parsed.quote === '"') {
        return `${parsed.prefix}${parsed.key}${parsed.separator}"${parsed.value}"${parsed.suffix}`;
    }
    if (parsed.quote === "'") {
        return `${parsed.prefix}${parsed.key}${parsed.separator}'${parsed.value}'${parsed.suffix}`;
    }
    return `${parsed.prefix}${parsed.key}${parsed.separator}${parsed.value}${parsed.suffix}`;
}

function splitLinesPreserveNewline(input: string): Array<{ line: string; newline: string }> {
    const parts: Array<{ line: string; newline: string }> = [];
    const regex = /([^\r\n]*)(\r\n|\n|\r|$)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
        const line = match[1];
        const newline = match[2];
        if (line === "" && newline === "" && match.index === input.length) {
            break;
        }
        parts.push({ line, newline });
        if (newline === "") {
            break;
        }
    }
    return parts;
}

function mergeDotenvMaskedValues(currentRaw: string, editedContent: string): string {
    const currentLines = splitLinesPreserveNewline(currentRaw);
    const editedLines = splitLinesPreserveNewline(editedContent);
    const currentQueuesByKey = new Map<string, Array<Exclude<ParsedEnvAssignment, { kind: "other" }>>>();

    for (const item of currentLines) {
        const parsed = parseEnvAssignmentLine(item.line);
        if (parsed.kind !== "assignment") continue;
        const arr = currentQueuesByKey.get(parsed.key) ?? [];
        arr.push(parsed);
        currentQueuesByKey.set(parsed.key, arr);
    }

    const output: string[] = [];
    for (const item of editedLines) {
        const parsedEdited = parseEnvAssignmentLine(item.line);
        if (parsedEdited.kind !== "assignment" || !isLikelySensitiveKey(parsedEdited.key)) {
            output.push(item.line + item.newline);
            continue;
        }

        const queue = currentQueuesByKey.get(parsedEdited.key);
        const currentParsed = queue?.shift();
        if (!currentParsed) {
            output.push(item.line + item.newline);
            continue;
        }

        if (parsedEdited.quote !== currentParsed.quote) {
            output.push(item.line + item.newline);
            continue;
        }

        const maskedCurrent = maskValue(currentParsed.value);
        if (parsedEdited.value !== maskedCurrent) {
            output.push(item.line + item.newline);
            continue;
        }

        const mergedLine = serializeEnvAssignment({
            ...parsedEdited,
            value: currentParsed.value,
        });
        output.push(mergedLine + item.newline);
    }

    return output.join("");
}

export function listWorkflowDirectory(slug: string, rawPath: string | undefined): WorkflowFileTreeResponse {
    const relativePath = normalizeRelativePath(rawPath ?? "", true);
    const absolutePath = resolveWorkflowTarget(slug, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw {
            status: 404,
            message: "Directory not found"
        };
    }
    assertExistingPathIsSafe(slug, absolutePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
        throw {
            status: 400,
            message: "path must be a directory"
        };
    }

    const names = fs.readdirSync(absolutePath);
    for (const name of names) {
        const childPath = path.join(absolutePath, name);
        if (fs.lstatSync(childPath).isSymbolicLink()) {
            throw {
                status: 400,
                message: "Workflow editor does not support symlinks"
            };
        }
    }
    const entries = names
        .map((name) => toFileNode(relativePath, name, path.join(absolutePath, name)))
        .sort(compareNodes);

    return {
        path: relativePath,
        entries,
    };
}

export function readWorkflowFileContent(slug: string, rawPath: string | undefined): WorkflowFileContentResponse {
    const relativePath = normalizeRelativePath(rawPath ?? "", false);
    const absolutePath = resolveWorkflowTarget(slug, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw {
            status: 404,
            message: "File not found"
        };
    }
    assertExistingPathIsSafe(slug, absolutePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
        throw {
            status: 400,
            message: "path must be a file"
        };
    }

    const bytes = fs.readFileSync(absolutePath);
    const etag = toEtag(bytes);
    const name = path.basename(relativePath);

    if (looksBinary(bytes)) {
        const response: WorkflowFileContentBinaryResponse = {
            path: relativePath,
            name,
            kind: "binary",
            etag,
            size_bytes: bytes.length,
            modified_at_ms: stat.mtimeMs,
            message: "This file appears to be binary and is not editable in the browser.",
        };
        return response;
    }

    const rawContent = bytes.toString("utf-8");
    const isDotenv = name === ".env";
    const content = isDotenv ? sanitizeStringContent(rawContent) : rawContent;
    const response: WorkflowFileContentTextResponse = {
        path: relativePath,
        name,
        kind: "text",
        encoding: "utf-8",
        content,
        etag,
        size_bytes: bytes.length,
        modified_at_ms: stat.mtimeMs,
    };
    return response;
}

export function saveWorkflowFileContent(slug: string, request: WorkflowFileSaveRequest): WorkflowFileSaveResponse {
    const relativePath = normalizeRelativePath(request.path, false);
    const absolutePath = resolveWorkflowTarget(slug, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw {
            status: 404,
            message: "File not found"
        };
    }
    assertExistingPathIsSafe(slug, absolutePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
        throw {
            status: 400,
            message: "path must be a file"
        };
    }

    const currentBytes = fs.readFileSync(absolutePath);
    const currentEtag = toEtag(currentBytes);
    if (currentEtag !== request.base_etag) {
        throw {
            status: 409,
            message: "File changed on disk. Please reload and try again."
        };
    }

    const name = path.basename(relativePath);
    const isDotenv = name === ".env";
    const nextContent = isDotenv
        ? mergeDotenvMaskedValues(currentBytes.toString("utf-8"), request.content)
        : request.content;

    fs.writeFileSync(absolutePath, nextContent, "utf-8");
    const nextBytes = fs.readFileSync(absolutePath);
    const nextStat = fs.statSync(absolutePath);

    return {
        path: relativePath,
        etag: toEtag(nextBytes),
        modified_at_ms: nextStat.mtimeMs,
        size_bytes: nextBytes.length,
    };
}

export function createWorkflowFileOrFolder(slug: string, rawParentPath: string | undefined, name: string, kind: "file" | "directory"): WorkflowFileNode {
    assertValidName(name);
    const parentRelativePath = normalizeRelativePath(rawParentPath ?? "", true);
    const parentAbsolutePath = resolveWorkflowTarget(slug, parentRelativePath);
    if (!fs.existsSync(parentAbsolutePath)) {
        throw {
            status: 404,
            message: "Parent directory not found"
        };
    }
    assertParentDirectoryIsSafeForCreate(slug, parentAbsolutePath);
    if (!fs.statSync(parentAbsolutePath).isDirectory()) {
        throw {
            status: 400,
            message: "parent_path must be a directory"
        };
    }

    const targetAbsolutePath = path.join(parentAbsolutePath, name);
    if (fs.existsSync(targetAbsolutePath)) {
        throw {
            status: 409,
            message: "A file or folder with that name already exists"
        };
    }

    if (kind === "directory") {
        fs.mkdirSync(targetAbsolutePath);
    } else {
        fs.writeFileSync(targetAbsolutePath, "", "utf-8");
    }

    return toFileNode(parentRelativePath, name, targetAbsolutePath);
}

export function uploadWorkflowFile(slug: string, rawParentPath: string | undefined, name: string, contentBytes: Buffer): WorkflowFileNode {
    assertValidName(name);
    const parentRelativePath = normalizeRelativePath(rawParentPath ?? "", true);
    const parentAbsolutePath = resolveWorkflowTarget(slug, parentRelativePath);
    if (!fs.existsSync(parentAbsolutePath)) {
        throw {
            status: 404,
            message: "Parent directory not found"
        };
    }
    assertParentDirectoryIsSafeForCreate(slug, parentAbsolutePath);
    if (!fs.statSync(parentAbsolutePath).isDirectory()) {
        throw {
            status: 400,
            message: "parent_path must be a directory"
        };
    }

    const targetAbsolutePath = path.join(parentAbsolutePath, name);
    if (fs.existsSync(targetAbsolutePath)) {
        throw {
            status: 409,
            message: "A file or folder with that name already exists"
        };
    }

    fs.writeFileSync(targetAbsolutePath, contentBytes);
    return toFileNode(parentRelativePath, name, targetAbsolutePath);
}

export function renameWorkflowPath(slug: string, rawPath: string | undefined, newName: string): { old_path: string; new_path: string; node: WorkflowFileNode } {
    assertValidName(newName);
    const relativePath = normalizeRelativePath(rawPath ?? "", false);
    const absolutePath = resolveWorkflowTarget(slug, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw {
            status: 404,
            message: "File or folder not found"
        };
    }
    assertExistingPathIsSafe(slug, absolutePath);

    const parentRelativePath = path.posix.dirname(relativePath) === "." ? "" : path.posix.dirname(relativePath);
    const parentAbsolutePath = resolveWorkflowTarget(slug, parentRelativePath);
    assertParentDirectoryIsSafeForCreate(slug, parentAbsolutePath);
    const newAbsolutePath = path.join(parentAbsolutePath, newName);
    const newRelativePath = parentRelativePath ? `${parentRelativePath}/${newName}` : newName;

    if (fs.existsSync(newAbsolutePath)) {
        throw {
            status: 409,
            message: "A file or folder with that name already exists"
        };
    }

    fs.renameSync(absolutePath, newAbsolutePath);
    const node = toFileNode(parentRelativePath, newName, newAbsolutePath);
    return {
        old_path: relativePath,
        new_path: newRelativePath,
        node,
    };
}

export function deleteWorkflowPath(slug: string, rawPath: string | undefined): void {
    const relativePath = normalizeRelativePath(rawPath ?? "", false);
    const absolutePath = resolveWorkflowTarget(slug, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw {
            status: 404,
            message: "File or folder not found"
        };
    }
    assertExistingPathIsSafe(slug, absolutePath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
        fs.rmSync(absolutePath, { recursive: true, force: false });
        return;
    }
    fs.unlinkSync(absolutePath);
}

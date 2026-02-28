import fs from "fs";
import path from "path";
import ignore, { Ignore } from "ignore";
import { execFile } from "child_process";
import { promisify } from "util";
import { assertEnv } from "./assert";
import { logInfo } from "../logging";

interface IgnoreRuleSet {
    basePath: string;
    matcher: Ignore;
}

const execFileAsync = promisify(execFile);
const WORKSPACE_DB_FILENAME = "data.db";

export function getWorkspaceDirFromEnv(): string {
    let workspaceDir = assertEnv("WORKSPACE_DIR");
    if (!path.isAbsolute(workspaceDir)) {
        workspaceDir = path.resolve(process.cwd(), workspaceDir);
    }
    return workspaceDir;
}

export function getWorkspaceDatabasePath(): string {
    return path.join(getWorkspaceDirFromEnv(), WORKSPACE_DB_FILENAME);
}

export function getWorkspaceDatabaseUrl(): string {
    return `file:${getWorkspaceDatabasePath()}`;
}

function parseSqlitePathFromPrismaUrl(url: string): string | null {
    if (!url.startsWith("file:")) {
        return null;
    }

    const withoutPrefix = url.slice("file:".length).split("?")[0];
    if (withoutPrefix.length === 0) {
        return null;
    }

    if (path.isAbsolute(withoutPrefix)) {
        return withoutPrefix;
    }

    return path.resolve(process.cwd(), "prisma", withoutPrefix);
}

function moveFile(sourcePath: string, targetPath: string): void {
    try {
        fs.renameSync(sourcePath, targetPath);
        return;
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "EXDEV") {
            throw err;
        }
    }

    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
}

function moveSqliteArtifacts(sourceDbPath: string, targetDbPath: string): boolean {
    const suffixes = ["", "-journal", "-shm", "-wal"];
    const sourcePaths = suffixes.map((suffix) => `${sourceDbPath}${suffix}`);
    const hasAnySource = sourcePaths.some((sourcePath) => fs.existsSync(sourcePath));
    if (!hasAnySource || fs.existsSync(targetDbPath)) {
        return false;
    }

    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    for (const suffix of suffixes) {
        const sourcePath = `${sourceDbPath}${suffix}`;
        if (!fs.existsSync(sourcePath)) {
            continue;
        }
        const targetPath = `${targetDbPath}${suffix}`;
        moveFile(sourcePath, targetPath);
    }
    return true;
}

function moveLegacyDatabaseIntoWorkspace(): void {
    const workspaceDbPath = getWorkspaceDatabasePath();
    if (fs.existsSync(workspaceDbPath)) {
        return;
    }

    const candidateSet = new Set<string>();
    candidateSet.add(path.resolve(process.cwd(), "prisma", "dev.db"));
    candidateSet.add("/app/data/data.db");

    const envDatabaseUrl = process.env.DATABASE_URL;
    if (typeof envDatabaseUrl === "string" && envDatabaseUrl.length > 0) {
        const parsedPath = parseSqlitePathFromPrismaUrl(envDatabaseUrl);
        if (parsedPath) {
            candidateSet.add(parsedPath);
        }
    }

    for (const candidate of candidateSet) {
        if (!fs.existsSync(candidate)) {
            continue;
        }
        const moved = moveSqliteArtifacts(candidate, workspaceDbPath);
        if (moved) {
            logInfo(`Moved existing database into workspace: ${workspaceDbPath}`);
            return;
        }
    }
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.split(path.sep).join("/");
}

function shouldSkipWorkflowContent(relativePath: string): boolean {
    return relativePath === "workflows" || relativePath.startsWith("workflows/");
}

function evaluateIgnoreRuleSets(
    relativePath: string,
    isDirectory: boolean,
    ruleSets: IgnoreRuleSet[]
): boolean {
    let isIgnored = false;

    for (const ruleSet of ruleSets) {
        if (ruleSet.basePath.length > 0) {
            if (relativePath !== ruleSet.basePath && !relativePath.startsWith(`${ruleSet.basePath}/`)) {
                continue;
            }
        }

        const relativeToRuleBase = ruleSet.basePath.length > 0
            ? relativePath.slice(ruleSet.basePath.length + 1)
            : relativePath;

        if (!relativeToRuleBase) {
            continue;
        }

        const candidates = isDirectory
            ? [relativeToRuleBase, `${relativeToRuleBase}/`]
            : [relativeToRuleBase];

        for (const candidate of candidates) {
            const result = ruleSet.matcher.test(candidate);
            if (result.ignored) {
                isIgnored = true;
            }
            if (result.unignored) {
                isIgnored = false;
            }
        }
    }

    return isIgnored;
}

function readLocalGitignoreRuleSet(sourceDirectory: string, relativePath: string): IgnoreRuleSet | null {
    const gitignorePath = path.join(sourceDirectory, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
        return null;
    }

    const matcher = ignore();
    matcher.add(fs.readFileSync(gitignorePath, "utf-8"));
    return {
        basePath: relativePath,
        matcher,
    };
}

function syncTemplateDirectory(
    sourceDirectory: string,
    targetDirectory: string,
    relativePath: string,
    inheritedRuleSets: IgnoreRuleSet[]
): void {
    const localRuleSet = readLocalGitignoreRuleSet(sourceDirectory, relativePath);
    const activeRuleSets = localRuleSet ? [...inheritedRuleSets, localRuleSet] : inheritedRuleSets;

    fs.mkdirSync(targetDirectory, { recursive: true });

    const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
        const sourceEntryPath = path.join(sourceDirectory, entry.name);
        const targetEntryPath = path.join(targetDirectory, entry.name);
        const relativeEntryPath = normalizeRelativePath(
            relativePath.length > 0 ? path.join(relativePath, entry.name) : entry.name
        );

        if (shouldSkipWorkflowContent(relativeEntryPath)) {
            continue;
        }

        const isDirectory = entry.isDirectory();
        if (evaluateIgnoreRuleSets(relativeEntryPath, isDirectory, activeRuleSets)) {
            continue;
        }

        if (isDirectory) {
            syncTemplateDirectory(sourceEntryPath, targetEntryPath, relativeEntryPath, activeRuleSets);
            continue;
        }

        if (entry.isFile()) {
            fs.copyFileSync(sourceEntryPath, targetEntryPath);
        }
    }
}

export function initializeWorkspaceDirectory(): void {
    const workspaceDir = getWorkspaceDirFromEnv();
    fs.mkdirSync(workspaceDir, { recursive: true });

    const workspaceTemplateDir = path.join(process.cwd(), "src", "workspace_files");
    if (!fs.existsSync(workspaceTemplateDir)) {
        throw new Error(`Workspace template directory not found: ${workspaceTemplateDir}`);
    }

    syncTemplateDirectory(workspaceTemplateDir, workspaceDir, "", []);
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });
}

export async function ensureWorkspaceDatabase(): Promise<void> {
    moveLegacyDatabaseIntoWorkspace();

    const workspaceDatabaseUrl = getWorkspaceDatabaseUrl();
    process.env.DATABASE_URL = workspaceDatabaseUrl;

    await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DATABASE_URL: workspaceDatabaseUrl,
        },
    });
}

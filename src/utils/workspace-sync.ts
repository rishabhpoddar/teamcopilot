import fs from "fs";
import path from "path";
import ignore, { Ignore } from "ignore";
import { execFile } from "child_process";
import { promisify } from "util";
import { assertEnv } from "./assert";
import { getPackageRoot, getPrismaSchemaPath, getWorkspaceTemplateDirectory } from "./runtime-paths";

interface IgnoreRuleSet {
    basePath: string;
    matcher: Ignore;
}

const execFileAsync = promisify(execFile);
const WORKSPACE_DB_DIRECTORY = ".sqlite";
const WORKSPACE_DB_FILENAME = "data.db";
const HONEYTOKEN_UUID = "1f9f0b72-5f9f-4c9b-aef1-2fb2e0f6d8c4";
const HONEYTOKEN_FILE_NAME = `honeytoken-${HONEYTOKEN_UUID}.txt`;
const WORKSPACE_AZURE_PROVIDER_VERSION = "3.0.48";

export function getWorkspaceDirFromEnv(): string {
    let workspaceDir = assertEnv("WORKSPACE_DIR");
    if (!path.isAbsolute(workspaceDir)) {
        workspaceDir = path.resolve(process.cwd(), workspaceDir);
    }
    return workspaceDir;
}

function getPrismaCliEntrypoint(): string {
    return require.resolve("prisma/build/index.js", {
        paths: [getPackageRoot()],
    });
}

function getWorkspaceDatabasePath(): string {
    return path.join(getWorkspaceDirFromEnv(), WORKSPACE_DB_DIRECTORY, WORKSPACE_DB_FILENAME);
}

export function getWorkspaceDatabaseUrl(): string {
    return `file:${getWorkspaceDatabasePath()}`;
}

export function workspaceDatabaseExists(): boolean {
    return fs.existsSync(getWorkspaceDatabasePath());
}

export function ensureWorkspaceDatabaseDirectory(): void {
    fs.mkdirSync(path.dirname(getWorkspaceDatabasePath()), { recursive: true });
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.split(path.sep).join("/");
}

function shouldSkipManagedDirectoryContent(relativePath: string): boolean {
    if (relativePath === "workflows" || relativePath.startsWith("workflows/")) {
        return true;
    }

    if (relativePath === ".agents/skills" || relativePath.startsWith(".agents/skills/")) {
        return true;
    }

    if (relativePath === ".opencode/xdg-data" || relativePath.startsWith(".opencode/xdg-data/")) {
        return true;
    }

    return false;
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

function mergeGitignoreFile(sourceGitignorePath: string, targetGitignorePath: string): void {
    const sourceLines = fs.readFileSync(sourceGitignorePath, "utf-8").split(/\r?\n/);
    if (!fs.existsSync(targetGitignorePath)) {
        fs.writeFileSync(targetGitignorePath, `${sourceLines.join("\n").replace(/\n*$/, "\n")}`, "utf-8");
        return;
    }

    const existingContent = fs.readFileSync(targetGitignorePath, "utf-8");
    const existingLines = existingContent.split(/\r?\n/);
    const existingEntries = new Set(existingLines);
    const linesToAppend: string[] = [];

    for (const sourceLine of sourceLines) {
        if (sourceLine.length === 0 || existingEntries.has(sourceLine)) {
            continue;
        }
        existingEntries.add(sourceLine);
        linesToAppend.push(sourceLine);
    }

    if (linesToAppend.length === 0) {
        return;
    }

    const needsSeparator = existingContent.length > 0 && !existingContent.endsWith("\n");
    const prefix = needsSeparator ? "\n" : "";
    const suffix = existingContent.endsWith("\n") || existingContent.length === 0 ? "" : "\n";
    fs.writeFileSync(
        targetGitignorePath,
        `${existingContent}${suffix}${prefix}${linesToAppend.join("\n")}\n`,
        "utf-8"
    );
}

function mergePackageJsonFile(sourcePackageJsonPath: string, targetPackageJsonPath: string): void {
    const sourcePackageJson = JSON.parse(fs.readFileSync(sourcePackageJsonPath, "utf-8")) as Record<string, unknown>;
    if (!fs.existsSync(targetPackageJsonPath)) {
        fs.writeFileSync(targetPackageJsonPath, `${JSON.stringify(sourcePackageJson, null, 2)}\n`, "utf-8");
        return;
    }

    const targetPackageJson = JSON.parse(fs.readFileSync(targetPackageJsonPath, "utf-8")) as Record<string, unknown>;
    const mergedPackageJson: Record<string, unknown> = {
        ...sourcePackageJson,
        ...targetPackageJson,
        dependencies: {
            ...((sourcePackageJson.dependencies as Record<string, unknown> | undefined) ?? {}),
            ...((targetPackageJson.dependencies as Record<string, unknown> | undefined) ?? {}),
        },
        devDependencies: {
            ...((sourcePackageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
            ...((targetPackageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
        },
        scripts: {
            ...((sourcePackageJson.scripts as Record<string, unknown> | undefined) ?? {}),
            ...((targetPackageJson.scripts as Record<string, unknown> | undefined) ?? {}),
        },
    };

    fs.writeFileSync(targetPackageJsonPath, `${JSON.stringify(mergedPackageJson, null, 2)}\n`, "utf-8");
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

        if (shouldSkipManagedDirectoryContent(relativeEntryPath)) {
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
            if (entry.name === ".gitignore") {
                mergeGitignoreFile(sourceEntryPath, targetEntryPath);
                continue;
            }
            if (relativeEntryPath === ".opencode/opencode.json" && fs.existsSync(targetEntryPath)) {
                continue;
            }
            if (entry.name === "package.json") {
                mergePackageJsonFile(sourceEntryPath, targetEntryPath);
                continue;
            }
            fs.copyFileSync(sourceEntryPath, targetEntryPath);
        }
    }
}

async function initializeWorkspaceNodeDependencies(workspaceDir: string): Promise<void> {
    const workspacePackageJsonPath = path.join(workspaceDir, "package.json");
    const existingPackageJson = fs.existsSync(workspacePackageJsonPath)
        ? JSON.parse(fs.readFileSync(workspacePackageJsonPath, "utf-8"))
        : {};
    const dependencies = {
        ...(existingPackageJson.dependencies ?? {}),
        "opencode-ai": "1.1.65",
    };
    if (assertEnv("OPENCODE_MODEL").startsWith("azure-openai/")) {
        dependencies["@ai-sdk/azure"] = WORKSPACE_AZURE_PROVIDER_VERSION;
    }
    const workspacePackageJson = {
        ...existingPackageJson,
        dependencies,
    };
    fs.writeFileSync(workspacePackageJsonPath, JSON.stringify(workspacePackageJson, null, 2), "utf-8");
    await execFileAsync("npm", ["install"], {
        cwd: workspaceDir,
        env: process.env,
    });
}

export async function initializeWorkspaceDirectory(): Promise<void> {
    const workspaceDir = getWorkspaceDirFromEnv();
    fs.mkdirSync(workspaceDir, { recursive: true });
    const workflowsDir = path.join(workspaceDir, "workflows");
    fs.mkdirSync(workflowsDir, { recursive: true });
    const skillsDir = path.join(workspaceDir, ".agents", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const honeytokenValue = `DO_NOT_EXPOSE:${HONEYTOKEN_UUID}\n`;
    fs.writeFileSync(path.join(workflowsDir, HONEYTOKEN_FILE_NAME), honeytokenValue, "utf-8");
    fs.writeFileSync(path.join(skillsDir, HONEYTOKEN_FILE_NAME), honeytokenValue, "utf-8");

    const workspaceTemplateDir = getWorkspaceTemplateDirectory();
    syncTemplateDirectory(workspaceTemplateDir, workspaceDir, "", []);

    await initializeWorkspaceNodeDependencies(workspaceDir);
}

export async function ensureWorkspaceDatabase(): Promise<void> {
    const workspaceDatabaseUrl = getWorkspaceDatabaseUrl();
    ensureWorkspaceDatabaseDirectory();
    process.env.DATABASE_URL = workspaceDatabaseUrl;

    await execFileAsync(process.execPath, [getPrismaCliEntrypoint(), "migrate", "deploy", "--schema", getPrismaSchemaPath()], {
        cwd: getPackageRoot(),
        env: {
            ...process.env,
            DATABASE_URL: workspaceDatabaseUrl,
        },
    });
}

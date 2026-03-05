import fs from "fs/promises";
import path from "path";
import { assertEnv } from "./assert";
import { getWorkspaceDirFromEnv } from "./workspace-sync";

type ProviderAuthInfo =
    | {
        type: "api";
        key: string;
    }
    | {
        type: "oauth";
        refresh: string;
        access: string;
        expires: number;
        accountId?: string;
        enterpriseUrl?: string;
    };

type AuthRecord = Record<string, ProviderAuthInfo>;

const WORKSPACE_OPENCODE_DIR = ".opencode";
const WORKSPACE_AUTH_FILE = "auth.json";
const RUNTIME_DATA_HOME_DIR = "xdg-data";

function getWorkspaceOpencodeDir(): string {
    return path.join(getWorkspaceDirFromEnv(), WORKSPACE_OPENCODE_DIR);
}

function getRuntimeDataHomePath(): string {
    return path.join(getWorkspaceOpencodeDir(), RUNTIME_DATA_HOME_DIR);
}

function getRuntimeAuthPath(): string {
    return path.join(getRuntimeDataHomePath(), "opencode", WORKSPACE_AUTH_FILE);
}

function normalizeProviderId(providerId: string): string {
    return providerId.replace(/\/+$/, "");
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isValidProviderAuthInfo(value: unknown): value is ProviderAuthInfo {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    if (candidate.type === "api") {
        return isNonEmptyString(candidate.key);
    }

    if (candidate.type === "oauth") {
        const hasOptionalAccountId = candidate.accountId === undefined || isNonEmptyString(candidate.accountId);
        const hasOptionalEnterpriseUrl = candidate.enterpriseUrl === undefined || isNonEmptyString(candidate.enterpriseUrl);
        return (
            isNonEmptyString(candidate.refresh)
            && isNonEmptyString(candidate.access)
            && typeof candidate.expires === "number"
            && Number.isFinite(candidate.expires)
            && hasOptionalAccountId
            && hasOptionalEnterpriseUrl
        );
    }

    return false;
}

async function readAuthRecord(filepath: string): Promise<AuthRecord> {
    try {
        const content = await fs.readFile(filepath, "utf-8");
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const entries: AuthRecord = {};

        for (const [providerId, info] of Object.entries(parsed)) {
            if (!isValidProviderAuthInfo(info)) {
                continue;
            }
            entries[providerId] = info;
        }

        return entries;
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
            return {};
        }
        throw err;
    }
}

async function writeAuthRecord(filepath: string, data: AuthRecord): Promise<void> {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
    });
    await fs.rename(tempPath, filepath);
    await fs.chmod(filepath, 0o600).catch(() => {});
}

export function getConfiguredModelProviderId(): string {
    const model = assertEnv("OPENCODE_MODEL");
    const [providerId, ...parts] = model.split("/");
    if (!providerId || parts.length === 0) {
        throw new Error("OPENCODE_MODEL must be in the format <provider>/<model>");
    }
    return providerId;
}

function configureOpencodeDataHome(): string {
    const runtimeDataHome = getRuntimeDataHomePath();
    process.env.XDG_DATA_HOME = runtimeDataHome;
    return runtimeDataHome;
}

export async function initializeOpencodeAuthStorage(): Promise<void> {
    configureOpencodeDataHome();
    await fs.mkdir(getWorkspaceOpencodeDir(), { recursive: true });
    const runtimeAuthPath = getRuntimeAuthPath();
    try {
        await fs.access(runtimeAuthPath);
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
            throw err;
        }
        await writeAuthRecord(runtimeAuthPath, {});
    }
}

function getAuthForProvider(record: AuthRecord, providerId: string): ProviderAuthInfo | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    return record[providerId] || record[normalizedProviderId] || record[`${normalizedProviderId}/`];
}

export async function getRuntimeProviderAuth(providerId: string): Promise<ProviderAuthInfo | undefined> {
    const record = await readAuthRecord(getRuntimeAuthPath());
    return getAuthForProvider(record, providerId);
}

export async function setRuntimeProviderAuth(providerId: string, info: ProviderAuthInfo): Promise<void> {
    const normalizedProviderId = normalizeProviderId(providerId);
    const runtimeRecord = await readAuthRecord(getRuntimeAuthPath());
    delete runtimeRecord[providerId];
    delete runtimeRecord[`${normalizedProviderId}/`];
    runtimeRecord[normalizedProviderId] = info;
    await writeAuthRecord(getRuntimeAuthPath(), runtimeRecord);
}

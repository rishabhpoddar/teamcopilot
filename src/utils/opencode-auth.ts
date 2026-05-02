import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import { assertEnv } from "./assert";
import { getWorkspaceDirFromEnv } from "./workspace-sync";

function isGoogleVertexManagedProvider(providerId: string): boolean {
    const id = normalizeProviderId(providerId).toLowerCase();
    return id === "google-vertex" || id.startsWith("google-vertex-");
}

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

type OpencodeConfigRecord = {
    $schema?: string;
    provider?: Record<string, {
        options?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
};

const WORKSPACE_OPENCODE_DIR = ".opencode";
const WORKSPACE_AUTH_FILE = "auth.json";
const WORKSPACE_CONFIG_FILE = "opencode.json";
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

function getWorkspaceOpencodeConfigPath(): string {
    return path.join(getWorkspaceOpencodeDir(), WORKSPACE_CONFIG_FILE);
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
    await fs.chmod(filepath, 0o600).catch(() => { });
}

async function readOpencodeConfig(filepath: string): Promise<OpencodeConfigRecord> {
    try {
        const content = await fs.readFile(filepath, "utf-8");
        const parsed = JSON.parse(content) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Invalid opencode config");
        }
        return parsed as OpencodeConfigRecord;
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
            return {
                $schema: "https://opencode.ai/config.json",
            };
        }
        throw err;
    }
}

async function writeOpencodeConfig(filepath: string, data: OpencodeConfigRecord): Promise<void> {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
    });
    await fs.rename(tempPath, filepath);
    await fs.chmod(filepath, 0o600).catch(() => { });
}

export function getConfiguredModelProviderId(): string {
    const model = assertEnv("OPENCODE_MODEL");
    const [providerId, ...parts] = model.split("/");
    if (!providerId || parts.length === 0) {
        throw new Error("OPENCODE_MODEL must be in the format <provider>/<model>");
    }
    return providerId;
}

function getConfiguredModelId(): string {
    const model = assertEnv("OPENCODE_MODEL");
    const [providerId, ...parts] = model.split("/");
    if (!providerId || parts.length === 0) {
        throw new Error("OPENCODE_MODEL must be in the format <provider>/<model>");
    }
    return parts.join("/");
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

function isAzureCustomProvider(providerId: string): boolean {
    return normalizeProviderId(providerId).toLowerCase() === "azure-openai";
}

/** Service-level credentials (TeamCopilot env, not per-user auth UI) — keep in sync with isManagedServiceLevelProvider in OpencodeAuthSetup.tsx */
export function isServiceManagedProvider(providerId: string): boolean {
    return isAzureCustomProvider(providerId) || isGoogleVertexManagedProvider(providerId);
}

function normalizeAzureEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, "");
}

function hasRequiredAzureEnvironment(): boolean {
    return isNonEmptyString(process.env.AZURE_API_KEY)
        && isNonEmptyString(process.env.AZURE_OPENAI_ENDPOINT);
}

function getGoogleCloudProjectFromEnv(): string | undefined {
    const trimmed = (process.env.GOOGLE_CLOUD_PROJECT ?? "").trim();
    return isNonEmptyString(trimmed) ? trimmed : undefined;
}

async function hasRequiredVertexManagedProject(): Promise<boolean> {
    return getGoogleCloudProjectFromEnv() !== undefined && hasVertexLocationConfigured() && await googleApplicationCredentialsConfigured();
}

function hasVertexLocationConfigured(): boolean {
    return isNonEmptyString(process.env.VERTEX_LOCATION?.trim());
}

async function googleApplicationCredentialsConfigured(): Promise<boolean> {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!credPath) {
        return false;
    }

    try {
        await fs.access(credPath, fsConstants.R_OK);
        return true;
    } catch {
        return false;
    }
}

async function hasVertexManagedRuntimeReady(providerId: string): Promise<boolean> {
    if (!isGoogleVertexManagedProvider(providerId)) {
        return false;
    }

    if (!(await hasRequiredVertexManagedProject())) {
        return false;
    }

    const modelTail = getConfiguredModelId().trim();
    if (!modelTail) {
        return false;
    }

    return true;
}

async function hasAzureProviderConfiguration(providerId: string): Promise<boolean> {
    const deployment = getConfiguredModelId().trim();
    const config = await readOpencodeConfig(getWorkspaceOpencodeConfigPath());
    const provider = config.provider?.[normalizeProviderId(providerId)];
    if (!provider || provider.npm !== "@ai-sdk/azure") {
        return false;
    }

    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) {
        return false;
    }

    const deploymentConfig = (models as Record<string, unknown>)[deployment];
    return Boolean(deploymentConfig && typeof deploymentConfig === "object" && !Array.isArray(deploymentConfig));
}

export async function hasRuntimeProviderCredentials(providerId: string): Promise<boolean> {
    if (isAzureCustomProvider(providerId)) {
        return hasRequiredAzureEnvironment() && await hasAzureProviderConfiguration(providerId);
    }

    if (isGoogleVertexManagedProvider(providerId)) {
        return await hasVertexManagedRuntimeReady(providerId);
    }

    return Boolean(await getRuntimeProviderAuth(providerId));
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

export async function syncManagedProviderConfiguration(): Promise<void> {
    // Azure OpenAI: workspace opencode.json must list the deployment, base URL, and @ai-sdk/azure options.
    // Google Vertex providers are built into OpenCode; project/region/credentials come from process env only — no stanza needed here.

    const providerId = getConfiguredModelProviderId();
    if (!isAzureCustomProvider(providerId) || !hasRequiredAzureEnvironment()) {
        return;
    }

    const endpoint = normalizeAzureEndpoint(assertEnv("AZURE_OPENAI_ENDPOINT"));
    const deployment = getConfiguredModelId().trim();
    const normalizedProviderId = normalizeProviderId(providerId);
    const configPath = getWorkspaceOpencodeConfigPath();
    const configRecord = await readOpencodeConfig(configPath);
    const providerRecord = configRecord.provider ?? {};
    const existingProviderConfig = providerRecord[normalizedProviderId];

    configRecord.provider = {
        ...providerRecord,
        [normalizedProviderId]: {
            ...(existingProviderConfig ?? {}),
            npm: "@ai-sdk/azure",
            name: "Azure OpenAI",
            models: {
                [deployment]: {
                    name: deployment,
                },
            },
            options: {
                ...((existingProviderConfig?.options ?? {}) as Record<string, unknown>),
                baseURL: `${endpoint}/openai`,
                apiVersion: "v1",
                // Azure Codex deployments require the v1 Responses API instead of the
                // legacy deployment-based chat/completions endpoint.
                useDeploymentBasedUrls: false,
            },
        },
    };

    await writeOpencodeConfig(configPath, configRecord);
}

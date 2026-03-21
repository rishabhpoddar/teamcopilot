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
type ProviderEnvironmentRecord = Record<string, Record<string, string>>;

type ProviderConfigField = {
    key: string;
    label: string;
    placeholder: string;
    help: string;
    required: boolean;
    input: "text" | "checkbox";
};

type ProviderEnvironmentField = ProviderConfigField & {
    envKey: string;
};

type ProviderOptionField = ProviderConfigField & {
    optionKey: string;
};

type ProviderSetupDefinition = {
    configFields: ProviderEnvironmentField[];
    optionFields: ProviderOptionField[];
    notes: string[];
    apiKeyEnvKey?: string;
};

const WORKSPACE_OPENCODE_DIR = ".opencode";
const WORKSPACE_AUTH_FILE = "auth.json";
const WORKSPACE_PROVIDER_ENV_FILE = "provider-env.json";
const WORKSPACE_CONFIG_FILE = "opencode.json";
const RUNTIME_DATA_HOME_DIR = "xdg-data";
const AZURE_API_KEY_ENV_KEY = "AZURE_API_KEY";

function getWorkspaceOpencodeDir(): string {
    return path.join(getWorkspaceDirFromEnv(), WORKSPACE_OPENCODE_DIR);
}

function getRuntimeDataHomePath(): string {
    return path.join(getWorkspaceOpencodeDir(), RUNTIME_DATA_HOME_DIR);
}

function getRuntimeAuthPath(): string {
    return path.join(getRuntimeDataHomePath(), "opencode", WORKSPACE_AUTH_FILE);
}

function getWorkspaceProviderEnvironmentPath(): string {
    return path.join(getRuntimeDataHomePath(), "opencode", WORKSPACE_PROVIDER_ENV_FILE);
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
    await fs.chmod(filepath, 0o600).catch(() => {});
}

async function readProviderEnvironmentRecord(filepath: string): Promise<ProviderEnvironmentRecord> {
    try {
        const content = await fs.readFile(filepath, "utf-8");
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const entries: ProviderEnvironmentRecord = {};

        for (const [providerId, value] of Object.entries(parsed)) {
            if (!value || typeof value !== "object") {
                continue;
            }

            const providerEnvironment: Record<string, string> = {};
            for (const [envKey, envValue] of Object.entries(value as Record<string, unknown>)) {
                if (!isNonEmptyString(envValue)) {
                    continue;
                }
                providerEnvironment[envKey] = envValue;
            }

            entries[providerId] = providerEnvironment;
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

async function writeProviderEnvironmentRecord(filepath: string, data: ProviderEnvironmentRecord): Promise<void> {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
    });
    await fs.rename(tempPath, filepath);
    await fs.chmod(filepath, 0o600).catch(() => {});
}

type OpencodeConfigRecord = {
    $schema?: string;
    provider?: Record<string, {
        options?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
};

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

    const providerEnvironmentPath = getWorkspaceProviderEnvironmentPath();
    try {
        await fs.access(providerEnvironmentPath);
    } catch (err) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
            throw err;
        }
        await writeProviderEnvironmentRecord(providerEnvironmentPath, {});
    }
}

function getAuthForProvider(record: AuthRecord, providerId: string): ProviderAuthInfo | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    return record[providerId] || record[normalizedProviderId] || record[`${normalizedProviderId}/`];
}

function getProviderEnvironmentForProvider(
    record: ProviderEnvironmentRecord,
    providerId: string,
): Record<string, string> | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    return record[providerId] || record[normalizedProviderId] || record[`${normalizedProviderId}/`];
}

function getProviderOptionsForProvider(
    record: OpencodeConfigRecord,
    providerId: string,
): Record<string, unknown> | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    const providerRecord = record.provider ?? {};
    return providerRecord[providerId]?.options
        || providerRecord[normalizedProviderId]?.options
        || providerRecord[`${normalizedProviderId}/`]?.options;
}

function isAzureCustomProvider(providerId: string): boolean {
    const normalizedProviderId = normalizeProviderId(providerId).toLowerCase();
    return normalizedProviderId.includes("azure") && normalizedProviderId !== "azure";
}

export function getProviderSetupDefinition(providerId: string): ProviderSetupDefinition {
    const normalizedProviderId = normalizeProviderId(providerId).toLowerCase();

    if (normalizedProviderId.includes("azure")) {
        return {
            configFields: [{
                key: "endpoint",
                envKey: "AZURE_OPENAI_ENDPOINT",
                label: "Azure Endpoint",
                placeholder: "https://my-resource.openai.azure.com/",
                help: "Full Azure OpenAI endpoint URL.",
                required: true,
                input: "text",
            }, {
                key: "apiVersion",
                envKey: "AZURE_OPENAI_API_VERSION",
                label: "API Version",
                placeholder: "2025-01-01-preview",
                help: "Azure OpenAI API version.",
                required: true,
                input: "text",
            }],
            optionFields: [],
            notes: [
                "Use a custom Azure provider id in OPENCODE_MODEL, for example `azure-openai/gpt-4.1-mini`.",
                "Azure requests will use /openai/deployments/{deployment}/chat/completions?api-version=...",
                "The model name in OPENCODE_MODEL must exactly match your Azure deployment name.",
            ],
            apiKeyEnvKey: AZURE_API_KEY_ENV_KEY,
        };
    }

    return {
        configFields: [],
        optionFields: [],
        notes: [],
    };
}

export function getProviderApiKeyEnvKey(providerId: string): string | undefined {
    return getProviderSetupDefinition(providerId).apiKeyEnvKey;
}

async function hasRequiredProviderEnvironment(providerId: string): Promise<boolean> {
    const definition = getProviderSetupDefinition(providerId);
    if (definition.configFields.length === 0 && !definition.apiKeyEnvKey) {
        return false;
    }

    const record = await readProviderEnvironmentRecord(getWorkspaceProviderEnvironmentPath());
    const providerEnvironment = getProviderEnvironmentForProvider(record, providerId);
    if (!providerEnvironment) {
        return false;
    }

    for (const field of definition.configFields) {
        if (!isNonEmptyString(providerEnvironment[field.envKey])) {
            return false;
        }
    }

    if (
        definition.apiKeyEnvKey
        && !isNonEmptyString(providerEnvironment[definition.apiKeyEnvKey])
    ) {
        return false;
    }

    return true;
}

async function hasRequiredProviderConfig(providerId: string): Promise<boolean> {
    if (!isAzureCustomProvider(providerId)) {
        return true;
    }

    const configRecord = await readOpencodeConfig(getWorkspaceOpencodeConfigPath());
    const normalizedProviderId = normalizeProviderId(providerId);
    const providerConfig = configRecord.provider?.[normalizedProviderId];
    if (!providerConfig || providerConfig.npm !== "@ai-sdk/azure") {
        return false;
    }

    const deployment = getConfiguredModelId().trim();
    const modelConfig = providerConfig.models;
    if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) {
        return false;
    }

    const configuredModel = (modelConfig as Record<string, unknown>)[deployment];
    if (!configuredModel || typeof configuredModel !== "object" || Array.isArray(configuredModel)) {
        return false;
    }

    return true;
}

export async function hasRuntimeProviderCredentials(providerId: string): Promise<boolean> {
    if (isAzureCustomProvider(providerId)) {
        return await hasRequiredProviderEnvironment(providerId) && await hasRequiredProviderConfig(providerId);
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

export async function getRuntimeProviderConfigValues(providerId: string): Promise<Record<string, string>> {
    const definition = getProviderSetupDefinition(providerId);
    const values: Record<string, string> = {};

    if (definition.configFields.length > 0) {
        const record = await readProviderEnvironmentRecord(getWorkspaceProviderEnvironmentPath());
        const providerEnvironment = getProviderEnvironmentForProvider(record, providerId) ?? {};

        for (const field of definition.configFields) {
            values[field.key] = providerEnvironment[field.envKey] ?? "";
        }
    }

    if (definition.optionFields.length > 0) {
        const configRecord = await readOpencodeConfig(getWorkspaceOpencodeConfigPath());
        const providerOptions = getProviderOptionsForProvider(configRecord, providerId) ?? {};

        for (const field of definition.optionFields) {
            const value = providerOptions[field.optionKey];
            if (field.input === "checkbox") {
                values[field.key] = value === true ? "true" : "false";
                continue;
            }
            values[field.key] = typeof value === "string" ? value : "";
        }
    }

    return values;
}

function normalizeAzureEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, "");
}

export async function setRuntimeProviderConfigValues(
    providerId: string,
    values: Record<string, string>,
): Promise<void> {
    const normalizedProviderId = normalizeProviderId(providerId);
    const definition = getProviderSetupDefinition(providerId);
    const nextProviderEnvironment: Record<string, string> = {};

    for (const field of definition.configFields) {
        const value = values[field.key];
        if (field.required && !isNonEmptyString(value)) {
            throw new Error(`${field.label} is required`);
        }
        if (isNonEmptyString(value)) {
            nextProviderEnvironment[field.envKey] = value.trim();
        }
    }

    if (definition.apiKeyEnvKey) {
        const apiKey = values.apiKey;
        if (!isNonEmptyString(apiKey)) {
            throw new Error("Provider API Key is required");
        }
        nextProviderEnvironment[definition.apiKeyEnvKey] = apiKey.trim();
    }

    const filepath = getWorkspaceProviderEnvironmentPath();
    if (definition.configFields.length > 0) {
        const record = await readProviderEnvironmentRecord(filepath);
        delete record[providerId];
        delete record[`${normalizedProviderId}/`];
        record[normalizedProviderId] = nextProviderEnvironment;
        await writeProviderEnvironmentRecord(filepath, record);
    }

    applyProviderEnvironmentToProcess(nextProviderEnvironment);

    if (definition.optionFields.length > 0) {
        const configPath = getWorkspaceOpencodeConfigPath();
        const configRecord = await readOpencodeConfig(configPath);
        const providerRecord = configRecord.provider ?? {};
        const existingProviderConfig = providerRecord[normalizedProviderId];
        const existingOptions = existingProviderConfig?.options ?? {};
        const nextOptions: Record<string, unknown> = {
            ...existingOptions,
        };

        for (const field of definition.optionFields) {
            const value = values[field.key];
            if (field.input === "checkbox") {
                nextOptions[field.optionKey] = value === "true";
                continue;
            }

            const trimmedValue = value?.trim() ?? "";
            if (!trimmedValue) {
                delete nextOptions[field.optionKey];
                continue;
            }
            nextOptions[field.optionKey] = trimmedValue;
        }

        configRecord.provider = {
            ...providerRecord,
            [normalizedProviderId]: {
                ...(existingProviderConfig ?? {}),
                options: nextOptions,
            },
        };
        await writeOpencodeConfig(configPath, configRecord);
    }

    if (normalizedProviderId.includes("azure")) {
        const endpoint = nextProviderEnvironment.AZURE_OPENAI_ENDPOINT;
        const apiVersion = nextProviderEnvironment.AZURE_OPENAI_API_VERSION;
        const deployment = getConfiguredModelId();

        if (!endpoint || !apiVersion) {
            throw new Error("Azure Endpoint and API Version are required");
        }

        delete nextProviderEnvironment.AZURE_OPENAI_DEPLOYMENT;

        const configPath = getWorkspaceOpencodeConfigPath();
        const configRecord = await readOpencodeConfig(configPath);
        const providerRecord = configRecord.provider ?? {};
        const existingProviderConfig = providerRecord[normalizedProviderId];
        const nextOptions: Record<string, unknown> = {
            ...((existingProviderConfig?.options ?? {}) as Record<string, unknown>),
            baseURL: `${normalizeAzureEndpoint(endpoint)}/openai`,
            apiVersion: apiVersion.trim(),
            useDeploymentBasedUrls: true,
        };

        configRecord.provider = {
            ...providerRecord,
            [normalizedProviderId]: {
                ...(existingProviderConfig ?? {}),
                ...(isAzureCustomProvider(normalizedProviderId)
                    ? {
                        npm: "@ai-sdk/azure",
                        name: "Azure OpenAI",
                        models: {
                            [deployment.trim()]: {
                                name: deployment.trim(),
                            },
                        },
                    }
                    : {}),
                options: nextOptions,
            },
        };
        await writeOpencodeConfig(configPath, configRecord);
    }
}

function applyProviderEnvironmentToProcess(providerEnvironment: Record<string, string>): void {
    for (const [envKey, envValue] of Object.entries(providerEnvironment)) {
        process.env[envKey] = envValue;
    }
}

export async function applyStoredProviderEnvironmentToProcess(): Promise<void> {
    const record = await readProviderEnvironmentRecord(getWorkspaceProviderEnvironmentPath());
    for (const providerEnvironment of Object.values(record)) {
        applyProviderEnvironmentToProcess(providerEnvironment);
    }
}

import prisma from "../prisma/client";

const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/;

type SecretResolutionResult = {
    secretMap: Record<string, string>;
    missingKeys: string[];
};

type SecretListItem = {
    key: string;
    value: string;
    updated_at: bigint;
    created_at: bigint;
};

export function assertSecretKey(key: string): string {
    const normalized = key.trim().toUpperCase();
    if (!SECRET_KEY_REGEX.test(normalized)) {
        throw {
            status: 400,
            message: "Secret key must contain only uppercase letters, numbers, and underscores, and must start with a letter"
        };
    }
    return normalized;
}

export function normalizeSecretKeyList(keys: string[] | undefined | null): string[] {
    if (!Array.isArray(keys)) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const rawKey of keys) {
        if (typeof rawKey !== "string") {
            continue;
        }
        const key = rawKey.trim().toUpperCase();
        if (!SECRET_KEY_REGEX.test(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(key);
    }
    return normalized;
}

function maskSecretValue(value: string): string {
    if (value.length === 0) {
        return "***";
    }
    const suffixLength = value.length <= 4 ? 1 : 4;
    return `***${value.slice(-suffixLength)}`;
}

export function toSecretListItem(row: {
    key: string;
    value: string;
    updated_at: bigint;
    created_at: bigint;
}, maskValueForClient: boolean): SecretListItem {
    return {
        key: row.key,
        value: maskValueForClient ? maskSecretValue(row.value) : row.value,
        updated_at: row.updated_at,
        created_at: row.created_at,
    };
}

export async function resolveSecretsForUser(userId: string, requiredKeys: string[]): Promise<SecretResolutionResult> {
    const keys = normalizeSecretKeyList(requiredKeys);
    if (keys.length === 0) {
        return {
            secretMap: {},
            missingKeys: [],
        };
    }

    const resolvedSecrets = await listResolvedSecretsForUser(userId);
    const secretMap: Record<string, string> = {};
    const missingKeys: string[] = [];

    for (const key of keys) {
        const value = resolvedSecrets[key];
        if (value !== undefined) {
            secretMap[key] = value;
            continue;
        }
        missingKeys.push(key);
    }

    return {
        secretMap,
        missingKeys,
    };
}

export async function listResolvedSecretsForUser(userId: string): Promise<Record<string, string>> {
    const [userSecrets, globalSecrets] = await Promise.all([
        prisma.user_secrets.findMany({
            where: { user_id: userId },
            orderBy: { key: "asc" }
        }),
        prisma.global_secrets.findMany({
            orderBy: { key: "asc" }
        }),
    ]);

    const resolvedSecretMap: Record<string, string> = {};
    for (const row of globalSecrets) {
        resolvedSecretMap[row.key] = row.value;
    }
    for (const row of userSecrets) {
        resolvedSecretMap[row.key] = row.value;
    }

    return Object.fromEntries(
        Object.entries(resolvedSecretMap).sort(([left], [right]) => left.localeCompare(right))
    );
}

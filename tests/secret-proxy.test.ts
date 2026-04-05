import assert from "node:assert/strict";
import { listResolvedSecretsForUser, resolveSecretsForUser } from "../src/utils/secrets";
import prisma from "../src/prisma/client";

async function main(): Promise<void> {
    const userId = `secret-proxy-user-${Date.now()}`;
    await prisma.users.create({
        data: {
            id: userId,
            email: `${userId}@example.com`,
            name: "Secret Proxy Test User",
            role: "User",
            created_at: BigInt(Date.now()),
            password_hash: "test-hash",
            must_change_password: false,
        }
    });

    try {
        await prisma.global_secrets.create({
            data: {
                id: `secret-proxy-global-${Date.now()}`,
                key: "GLOBAL_ONLY_KEY",
                value: "global-secret-value",
                created_by_user_id: userId,
                updated_by_user_id: userId,
                created_at: BigInt(Date.now()),
                updated_at: BigInt(Date.now()),
            }
        });

        await prisma.user_secrets.create({
            data: {
                id: `secret-proxy-user-secret-${Date.now()}`,
                user_id: userId,
                key: "USER_ONLY_KEY",
                value: "user-secret-value",
                created_at: BigInt(Date.now()),
                updated_at: BigInt(Date.now()),
            }
        });

        const resolvedList = await listResolvedSecretsForUser(userId);
        assert.deepEqual(
            resolvedList,
            {
                GLOBAL_ONLY_KEY: "global-secret-value",
                USER_ONLY_KEY: "user-secret-value",
            },
            "lists the merged user and global secret map",
        );

        const resolvedSpecific = await resolveSecretsForUser(
            userId,
            ["user_only_key", "GLOBAL_ONLY_KEY"],
        );
        assert.deepEqual(
            resolvedSpecific.secretMap,
            {
                USER_ONLY_KEY: "user-secret-value",
                GLOBAL_ONLY_KEY: "global-secret-value",
            },
            "resolves requested secret keys after normalization",
        );
        assert.deepEqual(
            resolvedSpecific.missingKeys,
            [],
            "does not report missing keys when all requested secrets exist",
        );

        await prisma.global_secrets.upsert({
            where: { key: "USER_ONLY_KEY" },
            create: {
                id: `secret-proxy-global-override-${Date.now()}`,
                key: "USER_ONLY_KEY",
                value: "global-should-not-win",
                created_by_user_id: userId,
                updated_by_user_id: userId,
                created_at: BigInt(Date.now()),
                updated_at: BigInt(Date.now()),
            },
            update: {
                value: "global-should-not-win",
                updated_by_user_id: userId,
                updated_at: BigInt(Date.now()),
            }
        });

        const userOverridesGlobal = await resolveSecretsForUser(
            userId,
            ["USER_ONLY_KEY"],
        );
        assert.deepEqual(
            userOverridesGlobal.secretMap,
            {
                USER_ONLY_KEY: "user-secret-value",
            },
            "user secret values override globals for the same key",
        );

        const missing = await resolveSecretsForUser(
            userId,
            ["MISSING_KEY", "GLOBAL_ONLY_KEY"],
        );
        assert.deepEqual(
            missing.secretMap,
            {
                GLOBAL_ONLY_KEY: "global-secret-value",
            },
            "returns the subset of requested secret values that resolve",
        );
        assert.deepEqual(
            missing.missingKeys,
            ["MISSING_KEY"],
            "reports missing requested secret keys",
        );

        const noRequestedKeys = await resolveSecretsForUser(userId, []);
        assert.deepEqual(noRequestedKeys.secretMap, {}, "returns an empty secret map when no keys are requested");
        assert.deepEqual(noRequestedKeys.missingKeys, [], "returns no missing keys when no keys are requested");

        console.log("Secret proxy tests passed");
    } finally {
        await prisma.user_secrets.deleteMany({ where: { user_id: userId } });
        await prisma.global_secrets.deleteMany({
            where: {
                OR: [
                    { created_by_user_id: userId },
                    { updated_by_user_id: userId },
                ]
            }
        });
        await prisma.users.delete({ where: { id: userId } });
    }
}

void main();

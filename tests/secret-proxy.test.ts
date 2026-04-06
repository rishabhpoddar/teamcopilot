import assert from "node:assert/strict";
import { listResolvedSecretsForUser, resolveSecretsForUser } from "../src/utils/secrets";
import prisma from "../src/prisma/client";

async function main(): Promise<void> {
    const userId = `secret-proxy-user-${Date.now()}`;
    const globalOnlyKey = `GLOBAL_ONLY_KEY_${Date.now()}`;
    const userOnlyKey = `USER_ONLY_KEY_${Date.now()}`;
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
                key: globalOnlyKey,
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
                key: userOnlyKey,
                value: "user-secret-value",
                created_at: BigInt(Date.now()),
                updated_at: BigInt(Date.now()),
            }
        });

        const resolvedList = await listResolvedSecretsForUser(userId);
        assert.deepEqual(
            {
                [globalOnlyKey]: resolvedList[globalOnlyKey],
                [userOnlyKey]: resolvedList[userOnlyKey],
            },
            {
                [globalOnlyKey]: "global-secret-value",
                [userOnlyKey]: "user-secret-value",
            },
            "lists the merged user and global secret map for this test user",
        );

        const resolvedSpecific = await resolveSecretsForUser(
            userId,
            [userOnlyKey.toLowerCase(), globalOnlyKey],
        );
        assert.deepEqual(
            resolvedSpecific.secretMap,
            {
                [userOnlyKey]: "user-secret-value",
                [globalOnlyKey]: "global-secret-value",
            },
            "resolves requested secret keys after normalization",
        );
        assert.deepEqual(
            resolvedSpecific.missingKeys,
            [],
            "does not report missing keys when all requested secrets exist",
        );

        await prisma.global_secrets.upsert({
            where: { key: userOnlyKey },
            create: {
                id: `secret-proxy-global-override-${Date.now()}`,
                key: userOnlyKey,
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
            [userOnlyKey],
        );
        assert.deepEqual(
            userOverridesGlobal.secretMap,
            {
                [userOnlyKey]: "user-secret-value",
            },
            "user secret values override globals for the same key",
        );

        const missing = await resolveSecretsForUser(
            userId,
            ["MISSING_KEY", globalOnlyKey],
        );
        assert.deepEqual(
            missing.secretMap,
            {
                [globalOnlyKey]: "global-secret-value",
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

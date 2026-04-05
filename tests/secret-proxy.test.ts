import assert from "node:assert/strict";
import { extractSecretPlaceholderKeys, resolveSecretPlaceholdersForUser } from "../src/utils/secrets";
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
        assert.deepEqual(
            extractSecretPlaceholderKeys("curl -H 'Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' {{SECRET:api_url}}"),
            ["GITHUB_TOKEN", "API_URL"],
            "extracts and normalizes placeholder keys",
        );

        assert.deepEqual(
            extractSecretPlaceholderKeys("echo {{SECRET:OPENAI_API_KEY}} {{SECRET:OPENAI_API_KEY}}"),
            ["OPENAI_API_KEY"],
            "deduplicates repeated placeholders",
        );

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

        const resolved = await resolveSecretPlaceholdersForUser(
            userId,
            "echo {{SECRET:USER_ONLY_KEY}} {{SECRET:GLOBAL_ONLY_KEY}}",
        );
        assert.deepEqual(resolved.referencedKeys, ["USER_ONLY_KEY", "GLOBAL_ONLY_KEY"], "tracks referenced keys");
        assert.equal(
            resolved.substitutedText,
            "echo user-secret-value global-secret-value",
            "substitutes placeholders with resolved values",
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

        const userOverridesGlobal = await resolveSecretPlaceholdersForUser(
            userId,
            "echo {{SECRET:USER_ONLY_KEY}}",
        );
        assert.equal(
            userOverridesGlobal.substitutedText,
            "echo user-secret-value",
            "user secret values override globals for the same key",
        );

        await assert.rejects(
            () => resolveSecretPlaceholdersForUser(
                userId,
                "echo {{SECRET:MISSING_KEY}} {{SECRET:GLOBAL_ONLY_KEY}}",
            ),
            /This command references missing secrets: MISSING_KEY\. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying\./,
            "throws with the exact missing placeholder keys when any are absent",
        );

        const noPlaceholders = await resolveSecretPlaceholdersForUser(userId, "echo hello");
        assert.deepEqual(noPlaceholders.referencedKeys, [], "returns no referenced keys when none exist");
        assert.equal(noPlaceholders.substitutedText, "echo hello", "leaves plain text untouched");

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

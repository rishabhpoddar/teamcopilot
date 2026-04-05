import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

async function main(): Promise<void> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-skill-route-"));
    process.env.WORKSPACE_DIR = workspaceDir;

    fs.mkdirSync(path.join(workspaceDir, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "workflows"), { recursive: true });

    const prisma = require("../src/prisma/client").default as typeof import("../src/prisma/client").default;
    const { ensureWorkspaceDatabase } = require("../src/utils/workspace-sync") as typeof import("../src/utils/workspace-sync");
    const { loadJwtSecret } = require("../src/utils/jwt-secret") as typeof import("../src/utils/jwt-secret");
    const { createSkill } = require("../src/utils/skill") as typeof import("../src/utils/skill");
    const { createApp } = require("../src/index") as typeof import("../src/index");

    try {
        await ensureWorkspaceDatabase();
        await loadJwtSecret();

        const now = BigInt(Date.now());
        const user = await prisma.users.create({
            data: {
                email: `skill-route-${Date.now()}@example.com`,
                name: "Skill Route Tester",
                role: "Engineer",
                created_at: now,
                password_hash: "hashed-password",
                must_change_password: false,
            },
        });

        const slug = "route-validation-skill";
        await createSkill({
            slug,
            createdByUserId: user.id,
        });

        const authToken = "route-validation-opencode-session";
        await prisma.chat_sessions.create({
            data: {
                user_id: user.id,
                opencode_session_id: authToken,
                title: "Route validation session",
                created_at: now,
                updated_at: now,
            },
        });
        const app = createApp();

        const readResponse = await request(app)
            .get(`/api/skills/${slug}/files/content`)
            .query({ path: "SKILL.md" })
            .set("Authorization", `Bearer ${authToken}`)
            .expect(200);

        assert.equal(readResponse.body.kind, "text");
        const baseEtag = readResponse.body.etag as string;
        assert.ok(typeof baseEtag === "string" && baseEtag.length > 0);

        const undeclaredPlaceholderContent = `---
name: "route-validation-skill"
description: "Route validation test"
required_secrets: []
---

Use this skill with {{SECRET:GITHUB_TOKEN}}.
`;

        const undeclaredPlaceholderResponse = await request(app)
            .put(`/api/skills/${slug}/files/content`)
            .set("Authorization", `Bearer ${authToken}`)
            .send({
                path: "SKILL.md",
                content: undeclaredPlaceholderContent,
                base_etag: baseEtag,
            })
            .expect(400);

        assert.equal(
            undeclaredPlaceholderResponse.body.message,
            "SKILL.md uses secret placeholders not declared in required_secrets: GITHUB_TOKEN",
        );

        const malformedRequiredSecretsContent = `---
name: "route-validation-skill"
description: "Route validation test"
required_secrets: ["GITHUB_TOKEN",
---

Use this skill safely.
`;

        const malformedRequiredSecretsResponse = await request(app)
            .put(`/api/skills/${slug}/files/content`)
            .set("Authorization", `Bearer ${authToken}`)
            .send({
                path: "SKILL.md",
                content: malformedRequiredSecretsContent,
                base_etag: baseEtag,
            })
            .expect(400);

        assert.equal(
            malformedRequiredSecretsResponse.body.message,
            "SKILL.md frontmatter required_secrets must be a valid string array",
        );

        const duplicateRequiredSecretsContent = `---
name: "route-validation-skill"
description: "Route validation test"
required_secrets:
  - GITHUB_TOKEN
  - github_token
---

Use this skill safely.
`;

        const duplicateRequiredSecretsResponse = await request(app)
            .put(`/api/skills/${slug}/files/content`)
            .set("Authorization", `Bearer ${authToken}`)
            .send({
                path: "SKILL.md",
                content: duplicateRequiredSecretsContent,
                base_etag: baseEtag,
            })
            .expect(400);

        assert.equal(
            duplicateRequiredSecretsResponse.body.message,
            "SKILL.md required_secrets contains duplicate required secret keys: GITHUB_TOKEN",
        );

        const validContent = `---
name: "route-validation-skill"
description: "Route validation test"
required_secrets:
  - GITHUB_TOKEN
---

Use this skill with {{SECRET:GITHUB_TOKEN}}.
`;

        const validSaveResponse = await request(app)
            .put(`/api/skills/${slug}/files/content`)
            .set("Authorization", `Bearer ${authToken}`)
            .send({
                path: "SKILL.md",
                content: validContent,
                base_etag: baseEtag,
            })
            .expect(200);

        assert.equal(validSaveResponse.body.path, "SKILL.md");
        assert.ok(typeof validSaveResponse.body.etag === "string" && validSaveResponse.body.etag.length > 0);

        console.log("Skill route validation tests passed");
    } finally {
        await prisma.$disconnect();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

void main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function runCreateSkill(content: string): {
    result?: {
        skill?: {
            slug?: string;
            description?: string;
            file_path?: string;
        };
    };
    savedContent?: string;
    error?: string;
} {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/createSkill.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.CREATE_SKILL_PLUGIN_PATH;
const skillContent = process.env.CREATE_SKILL_TEST_CONTENT || "";
const mod = await import(pluginPath);
let savedContent = null;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

globalThis.fetch = async (url, options = {}) => {
  const urlString = String(url);
  if (urlString.endsWith("/api/workflows/request-permission")) {
    return jsonResponse({ permission_id: "perm-1" });
  }
  if (urlString.endsWith("/api/workflows/permission-status/perm-1")) {
    return jsonResponse({ status: "approved", approved: true });
  }
  if (urlString.endsWith("/api/skills")) {
    return jsonResponse({ success: true });
  }
  if (urlString.includes("/api/skills/") && urlString.includes("/files/content?path=SKILL.md")) {
    return jsonResponse({
      path: "SKILL.md",
      kind: "text",
      content: "---\\nname: \\"github-curl-repo-intel\\"\\ndescription: \\"\\"\\nrequired_secrets: []\\n---\\n",
      etag: "etag-1",
    });
  }
  if (urlString.includes("/api/skills/") && urlString.endsWith("/files/content")) {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
    savedContent = String(body.content || "");
    const declaresGithubToken =
      savedContent.includes("required_secrets:\\n  - GITHUB_TOKEN") ||
      savedContent.includes("required_secrets:\\r\\n  - GITHUB_TOKEN");
    const usesGithubToken = savedContent.includes("{{SECRET:GITHUB_TOKEN}}");
    if (usesGithubToken && !declaresGithubToken) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: "SKILL.md uses secret placeholders not declared in required_secrets: GITHUB_TOKEN" }),
        text: async () => JSON.stringify({ message: "SKILL.md uses secret placeholders not declared in required_secrets: GITHUB_TOKEN" }),
      };
    }
    return jsonResponse({ success: true });
  }
  throw new Error("Unexpected fetch: " + urlString);
};

const hooks = await mod.CreateSkillPlugin({
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {},
  $: {},
  serverUrl: new URL("http://localhost"),
  client: {
    session: {
      get: async ({ path }) => {
        if (path.id === "child-session") {
          return { data: { id: "child-session", parentID: "root-session" } };
        }
        return { data: { id: path.id, parentID: null } };
      },
    },
  },
});

try {
  const output = await hooks.tool.createSkill.execute(
    {
      slug: "github-curl-repo-intel",
      description: "Query GitHub repository metadata, pull requests, and comments using curl",
      content: skillContent,
    },
    {
      directory: process.cwd(),
      sessionID: "child-session",
      messageID: "msg-1",
      callID: "call-1",
    }
  );
  console.log(JSON.stringify({ result: JSON.parse(output), savedContent }));
} catch (err) {
  console.log(JSON.stringify({
    savedContent,
    error: err instanceof Error ? err.message : String(err),
  }));
}
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                CREATE_SKILL_PLUGIN_PATH: pluginUrl,
                CREATE_SKILL_TEST_CONTENT: content,
            },
        },
    );

    if (result.status !== 0) {
        throw new Error(
            `Subprocess failed (${result.status}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    }

    const lines = (result.stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(jsonLine, `Missing JSON output from subprocess.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return JSON.parse(jsonLine) as {
        result?: {
            skill?: {
                slug?: string;
                description?: string;
                file_path?: string;
            };
        };
        savedContent?: string;
        error?: string;
    };
}

function main(): void {
    const skillContent = `---
name: "github-curl-repo-intel"
description: "Query GitHub repository metadata, pull requests, and comments using curl"
required_secrets:
  - GITHUB_TOKEN
---

Use this skill when the user wants GitHub repository information via \`curl\`.

## Authentication
For authenticated requests, use:
- \`-H "Authorization: Bearer {{SECRET:GITHUB_TOKEN}}"\`
- \`-H "Accept: application/vnd.github+json"\`
`;

    const result = runCreateSkill(skillContent);
    assert.equal(result.error, undefined, "createSkill should succeed when provided content declares the referenced secret");
    assert.equal(result.result?.skill?.slug, "github-curl-repo-intel");
    assert.ok(result.savedContent?.includes('name: "github-curl-repo-intel"'));
    assert.ok(result.savedContent?.includes('description: "Query GitHub repository metadata, pull requests, and comments using curl"'));
    assert.ok(
        result.savedContent?.includes("required_secrets:\n  - GITHUB_TOKEN"),
        "createSkill should preserve required_secrets from the provided frontmatter",
    );
    assert.ok(
        result.savedContent?.includes('{{SECRET:GITHUB_TOKEN}}'),
        "createSkill should preserve the unresolved placeholder in the saved skill body",
    );

    console.log("Create skill plugin tests passed");
}

main();

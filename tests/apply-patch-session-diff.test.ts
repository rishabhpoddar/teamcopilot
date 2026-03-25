import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type HookResult = {
    capturedPaths: string[];
    authorizationHeaders: string[];
};

const DUMMY_WORKSPACE_ROOT = "/tmp/teamcopilot-apply-patch-test-workspace";

function runApplyPatchCase(workspaceRoot: string, patch: string): HookResult {
    const pluginFile = path.resolve(
        process.cwd(),
        "src/workspace_files/.opencode/plugins/apply-patch-session-diff.ts",
    );
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.APPLY_PATCH_PLUGIN_PATH;
const workspaceRoot = process.env.APPLY_PATCH_WORKSPACE_ROOT;
const patch = process.env.APPLY_PATCH_PATCH_TEXT ?? "";
const mod = await import(pluginPath);
const capturedPaths = [];
const authorizationHeaders = [];
globalThis.fetch = async (_url, options = {}) => {
  const headers = options.headers ?? {};
  const authorization = typeof headers.Authorization === "string"
    ? headers.Authorization
    : typeof headers.authorization === "string"
      ? headers.authorization
      : "";
  authorizationHeaders.push(authorization);
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  capturedPaths.push(body.path);
  return {
    ok: true,
    text: async () => "",
  };
};
const hooks = await mod.ApplyPatchSessionDiffPlugin({
  directory: workspaceRoot,
  worktree: workspaceRoot,
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
await hooks["tool.execute.before"](
  {
    tool: "apply_patch",
    sessionID: "child-session",
    callID: "call-1",
    args: { patch },
  },
  {
    args: { patch },
  },
);
console.log(JSON.stringify({ capturedPaths, authorizationHeaders }));
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                APPLY_PATCH_PLUGIN_PATH: pluginUrl,
                APPLY_PATCH_WORKSPACE_ROOT: workspaceRoot,
                APPLY_PATCH_PATCH_TEXT: patch,
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

    return JSON.parse(jsonLine) as HookResult;
}

function assertCapturedPaths(label: string, patch: string, expectedPaths: string[]): void {
    const result = runApplyPatchCase(DUMMY_WORKSPACE_ROOT, patch);

    assert.deepEqual(result.capturedPaths, expectedPaths, label);
    assert.deepEqual(
        result.authorizationHeaders,
        expectedPaths.map(() => "Bearer root-session"),
        `${label} auth`,
    );
}

async function main(): Promise<void> {
    assertCapturedPaths(
        "Captures a single added file from a patch",
        `*** Begin Patch
  *** Add File: ${DUMMY_WORKSPACE_ROOT}/a.txt
+
  *** End Patch`,
        ["a.txt"],
    );

    assertCapturedPaths(
        "Captures multiple added files from a single patch",
        `*** Begin Patch
  *** Add File: ${DUMMY_WORKSPACE_ROOT}/b.txt
+
  *** Add File: ${DUMMY_WORKSPACE_ROOT}/c.txt
+
  *** Add File: ${DUMMY_WORKSPACE_ROOT}/d.txt
+
  *** End Patch`,
        ["b.txt", "c.txt", "d.txt"],
    );

    assertCapturedPaths(
        "Captures a single deleted file from a patch",
        `*** Begin Patch
  *** Delete File: ${DUMMY_WORKSPACE_ROOT}/a.txt
  *** End Patch`,
        ["a.txt"],
    );

    assertCapturedPaths(
        "Captures multiple deleted files from a single patch",
        `*** Begin Patch
  *** Delete File: ${DUMMY_WORKSPACE_ROOT}/b.txt
  *** Delete File: ${DUMMY_WORKSPACE_ROOT}/c.txt
  *** Delete File: ${DUMMY_WORKSPACE_ROOT}/d.txt
  *** End Patch`,
        ["b.txt", "c.txt", "d.txt"],
    );

    assertCapturedPaths(
        "Captures a single updated file from a patch",
        `*** Begin Patch
  *** Update File: ${DUMMY_WORKSPACE_ROOT}/a.txt
  @@
- 
+ hello
  *** End Patch`,
        ["a.txt"],
    );

    assertCapturedPaths(
        "Captures multiple updated files from a single patch",
        `*** Begin Patch
  *** Update File: ${DUMMY_WORKSPACE_ROOT}/a.txt
  @@
- 
+ hello
  *** Update File: ${DUMMY_WORKSPACE_ROOT}/b.txt
  @@
- 
+ hello
  *** Update File: ${DUMMY_WORKSPACE_ROOT}/c.txt
  @@
- 
+ hello
  *** End Patch`,
        ["a.txt", "b.txt", "c.txt"],
    );

    console.log("Apply patch session diff tests passed: 6");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

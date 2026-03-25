import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type HookResult = {
    capturedPaths: string[];
    authorizationHeaders: string[];
};

function runToolCase(
    workspaceRoot: string,
    tool: string,
    inputArgs: Record<string, unknown>,
    outputArgs: Record<string, unknown>,
): HookResult {
    const pluginFile = path.resolve(
        process.cwd(),
        "src/workspace_files/.opencode/plugins/apply-patch-session-diff.ts",
    );
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.APPLY_PATCH_PLUGIN_PATH;
const workspaceRoot = process.env.APPLY_PATCH_WORKSPACE_ROOT;
const tool = process.env.APPLY_PATCH_TOOL_NAME ?? "";
const inputArgs = JSON.parse(process.env.APPLY_PATCH_INPUT_ARGS_JSON ?? "{}");
const outputArgs = JSON.parse(process.env.APPLY_PATCH_OUTPUT_ARGS_JSON ?? "{}");
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
    tool,
    sessionID: "child-session",
    callID: "call-1",
    args: inputArgs,
  },
  {
    args: outputArgs,
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
                APPLY_PATCH_TOOL_NAME: tool,
                APPLY_PATCH_INPUT_ARGS_JSON: JSON.stringify(inputArgs),
                APPLY_PATCH_OUTPUT_ARGS_JSON: JSON.stringify(outputArgs),
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

async function createWorkspaceFixture(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "teamcopilot-apply-patch-test-workspace-"));

    await fs.writeFile(path.join(root, "a.txt"), "a\n", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "b\n", "utf8");
    await fs.writeFile(path.join(root, "c.txt"), "c\n", "utf8");
    await fs.writeFile(path.join(root, "root.txt"), "root\n", "utf8");
    await fs.writeFile(path.join(root, "space name.txt"), "space\n", "utf8");

    await fs.mkdir(path.join(root, "subdir"), { recursive: true });
    await fs.writeFile(path.join(root, "subdir", "nested-a.txt"), "nested-a\n", "utf8");
    await fs.writeFile(path.join(root, "subdir", "nested-b.txt"), "nested-b\n", "utf8");

    await fs.mkdir(path.join(root, "temp", "nested"), { recursive: true });
    await fs.writeFile(path.join(root, "temp", "one.txt"), "one\n", "utf8");
    await fs.writeFile(path.join(root, "temp", "nested", "two.txt"), "two\n", "utf8");

    return root;
}

function assertCapturedPaths(
    workspaceRoot: string,
    label: string,
    tool: string,
    inputArgs: Record<string, unknown>,
    outputArgs: Record<string, unknown>,
    expectedPaths: string[],
): void {
    const result = runToolCase(workspaceRoot, tool, inputArgs, outputArgs);

    assert.deepEqual(result.capturedPaths, expectedPaths, label);
    assert.deepEqual(
        result.authorizationHeaders,
        expectedPaths.map(() => "Bearer root-session"),
        `${label} auth`,
    );
}

async function main(): Promise<void> {
    const workspaceRoot = await createWorkspaceFixture();
    try {
        assertCapturedPaths(
            workspaceRoot,
            "Captures a single added file from a patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Add File: ${workspaceRoot}/a.txt
+
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Add File: ${workspaceRoot}/a.txt
+
  *** End Patch` },
            ["a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures multiple added files from a single patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Add File: ${workspaceRoot}/b.txt
+
  *** Add File: ${workspaceRoot}/c.txt
+
  *** Add File: ${workspaceRoot}/d.txt
+
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Add File: ${workspaceRoot}/b.txt
+
  *** Add File: ${workspaceRoot}/c.txt
+
  *** Add File: ${workspaceRoot}/d.txt
+
  *** End Patch` },
            ["b.txt", "c.txt", "d.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures a single deleted file from a patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/a.txt
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/a.txt
  *** End Patch` },
            ["a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures multiple deleted files from a single patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/b.txt
  *** Delete File: ${workspaceRoot}/c.txt
  *** Delete File: ${workspaceRoot}/d.txt
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/b.txt
  *** Delete File: ${workspaceRoot}/c.txt
  *** Delete File: ${workspaceRoot}/d.txt
  *** End Patch` },
            ["b.txt", "c.txt", "d.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures a single updated file from a patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  @@
- 
+ hello
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  @@
- 
+ hello
  *** End Patch` },
            ["a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures multiple updated files from a single patch",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  @@
- 
+ hello
  *** Update File: ${workspaceRoot}/b.txt
  @@
- 
+ hello
  *** Update File: ${workspaceRoot}/c.txt
  @@
- 
+ hello
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  @@
- 
+ hello
  *** Update File: ${workspaceRoot}/b.txt
  @@
- 
+ hello
  *** Update File: ${workspaceRoot}/c.txt
  @@
- 
+ hello
  *** End Patch` },
            ["a.txt", "b.txt", "c.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures both source and destination paths for apply_patch move",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  *** Move to: ${workspaceRoot}/moved-a.txt
  @@
-a
+moved
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Update File: ${workspaceRoot}/a.txt
  *** Move to: ${workspaceRoot}/moved-a.txt
  @@
-a
+moved
  *** End Patch` },
            ["a.txt", "moved-a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Reads nested apply_patch payloads",
            "apply_patch",
            { toolInput: { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/root.txt
  *** End Patch` } },
            { nested: { patch: `*** Begin Patch
  *** Delete File: ${workspaceRoot}/root.txt
  *** End Patch` } },
            ["root.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips apply_patch when payload is missing",
            "apply_patch",
            {},
            {},
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures a single file written via write tool",
            "write",
            { filepath: `${workspaceRoot}/written.txt`, content: "hello" },
            { filepath: `${workspaceRoot}/written.txt`, content: "hello" },
            ["written.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures write tool path from filePath alias in nested output",
            "write",
            {},
            { result: { filePath: `${workspaceRoot}/alias-written.txt` } },
            ["alias-written.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips outside-workspace file paths from write tool",
            "write",
            { filepath: "/tmp/teamcopilot-outside-write.txt", content: "hello" },
            { filepath: "/tmp/teamcopilot-outside-write.txt", content: "hello" },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips write tool when filepath is missing",
            "write",
            { content: "hello" },
            { content: "hello" },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures multiple files deleted via bash rm",
            "bash",
            { command: "rm a.txt b.txt c.txt", workdir: workspaceRoot },
            { command: "rm a.txt b.txt c.txt", workdir: workspaceRoot },
            ["a.txt", "b.txt", "c.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips outside-workspace file paths in bash rm",
            "bash",
            { command: `rm ${JSON.stringify("/tmp/teamcopilot-outside-rm.txt")} a.txt`, workdir: workspaceRoot },
            { command: `rm ${JSON.stringify("/tmp/teamcopilot-outside-rm.txt")} a.txt`, workdir: workspaceRoot },
            ["a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Ignores non-rm bash commands",
            "bash",
            { command: "echo hello && ls -la", workdir: workspaceRoot },
            { command: "echo hello && ls -la", workdir: workspaceRoot },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures files deleted after changing directories in bash",
            "bash",
            { command: "cd subdir && rm nested-a.txt nested-b.txt", workdir: workspaceRoot },
            { command: "cd subdir && rm nested-a.txt nested-b.txt", workdir: workspaceRoot },
            ["subdir/nested-a.txt", "subdir/nested-b.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures files from multiple rm segments in one bash command",
            "bash",
            { command: "rm a.txt && cd subdir && rm nested-a.txt", workdir: workspaceRoot },
            { command: "rm a.txt && cd subdir && rm nested-a.txt", workdir: workspaceRoot },
            ["a.txt", "subdir/nested-a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Tracks cwd changes back and forth across bash segments",
            "bash",
            { command: "cd subdir && rm nested-a.txt && cd .. && rm root.txt", workdir: workspaceRoot },
            { command: "cd subdir && rm nested-a.txt && cd .. && rm root.txt", workdir: workspaceRoot },
            ["subdir/nested-a.txt", "root.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures quoted file paths and ignores rm flags",
            "bash",
            { command: "rm -f -- \"space name.txt\" a.txt", workdir: workspaceRoot },
            { command: "rm -f -- \"space name.txt\" a.txt", workdir: workspaceRoot },
            ["space name.txt", "a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Captures absolute file paths in bash rm",
            "bash",
            {
                command: `rm ${JSON.stringify(path.join(workspaceRoot, "a.txt"))} ${JSON.stringify(path.join(workspaceRoot, "subdir", "nested-a.txt"))}`,
                workdir: workspaceRoot,
            },
            {
                command: `rm ${JSON.stringify(path.join(workspaceRoot, "a.txt"))} ${JSON.stringify(path.join(workspaceRoot, "subdir", "nested-a.txt"))}`,
                workdir: workspaceRoot,
            },
            ["a.txt", "subdir/nested-a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Normalizes relative path variants in bash rm",
            "bash",
            {
                command: "rm ./a.txt subdir/../b.txt",
                workdir: workspaceRoot,
            },
            {
                command: "rm ./a.txt subdir/../b.txt",
                workdir: workspaceRoot,
            },
            ["a.txt", "b.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips absolute directory paths in bash rm",
            "bash",
            {
                command: `rm -rf ${JSON.stringify(path.join(workspaceRoot, "temp"))}`,
                workdir: workspaceRoot,
            },
            {
                command: `rm -rf ${JSON.stringify(path.join(workspaceRoot, "temp"))}`,
                workdir: workspaceRoot,
            },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips relative directory paths in bash rm",
            "bash",
            { command: "rm -rf temp", workdir: workspaceRoot },
            { command: "rm -rf temp", workdir: workspaceRoot },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Deduplicates repeated bash rm targets",
            "bash",
            { command: "rm a.txt a.txt ./a.txt", workdir: workspaceRoot },
            { command: "rm a.txt a.txt ./a.txt", workdir: workspaceRoot },
            ["a.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Reads bash command from output cmd field",
            "bash",
            { workdir: workspaceRoot },
            { cmd: "rm c.txt", workdir: workspaceRoot },
            ["c.txt"],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips bash when command string is missing",
            "bash",
            { workdir: workspaceRoot },
            { workdir: workspaceRoot },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Skips outside-workspace apply_patch paths without failing",
            "apply_patch",
            { patch: `*** Begin Patch
  *** Delete File: /tmp/teamcopilot-outside-apply-patch.txt
  *** End Patch` },
            { patch: `*** Begin Patch
  *** Delete File: /tmp/teamcopilot-outside-apply-patch.txt
  *** End Patch` },
            [],
        );

        assertCapturedPaths(
            workspaceRoot,
            "Ignores unsupported tools entirely",
            "read",
            { filepath: `${workspaceRoot}/a.txt` },
            { filepath: `${workspaceRoot}/a.txt` },
            [],
        );

        console.log("Apply patch session diff tests passed: 27");
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

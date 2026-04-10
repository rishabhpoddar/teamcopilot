import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PluginResult = {
    error?: string;
    fetchCalled: boolean;
    output?: string;
};

function runWithoutInputs(): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/runWorkflow.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.RUN_WORKFLOW_PLUGIN_PATH;
const mod = await import(pluginPath);
let fetchCalled = false;

globalThis.fetch = async () => {
  fetchCalled = true;
  throw new Error("fetch should not be called when inputs is missing");
};

const hooks = await mod.RunWorkflowPlugin({
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
  await hooks.tool.runWorkflow.execute(
    {
      slug: "example-workflow",
    },
    {
      directory: process.cwd(),
      sessionID: "child-session",
      messageID: "msg-1",
      callID: "call-1",
    }
  );
  console.log(JSON.stringify({ fetchCalled }));
} catch (err) {
  console.log(JSON.stringify({
    fetchCalled,
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
                RUN_WORKFLOW_PLUGIN_PATH: pluginUrl,
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

    return JSON.parse(jsonLine) as PluginResult;
}

function runWithEmptyInputs(): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/runWorkflow.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.RUN_WORKFLOW_PLUGIN_PATH;
const mod = await import(pluginPath);
let fetchCalled = false;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

globalThis.fetch = async (url) => {
  fetchCalled = true;
  const urlString = String(url);
  if (urlString.endsWith("/api/workflows/execute")) {
    return jsonResponse({ execution_id: "exec-1" });
  }
  if (urlString.endsWith("/api/workflows/execute/exec-1")) {
    return jsonResponse({ status: "success", output: "ok" });
  }
  throw new Error("Unexpected fetch: " + urlString);
};

const hooks = await mod.RunWorkflowPlugin({
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
  const output = await hooks.tool.runWorkflow.execute(
    {
      slug: "example-workflow",
      inputs: {},
    },
    {
      directory: process.cwd(),
      sessionID: "child-session",
      messageID: "msg-1",
      callID: "call-1",
    }
  );
  console.log(JSON.stringify({ fetchCalled, output }));
} catch (err) {
  console.log(JSON.stringify({
    fetchCalled,
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
                RUN_WORKFLOW_PLUGIN_PATH: pluginUrl,
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

    return JSON.parse(jsonLine) as PluginResult;
}

function main(): void {
    const result = runWithoutInputs();

    assert.equal(result.fetchCalled, false, "runWorkflow should fail before attempting any network request when inputs is missing");
    assert.equal(
        result.error,
        'You must pass an inputs object when calling runWorkflow. The inputs object contains the workflow arguments. Inspect the workflow README or use the findSimilarWorkflow tool to see the available arguments and their default values. If a workflow has arguments, it\'s best practice to pass all of them even if they have default values, so that the user can see exactly what\'s passed. Example: {"inputs":{"topic":"weekly update","dry_run":true}}. If the workflow has no arguments, pass {"inputs":{}}.',
    );

    const emptyInputsResult = runWithEmptyInputs();
    assert.equal(emptyInputsResult.error, undefined, "runWorkflow should allow an explicitly empty inputs object");
    assert.equal(emptyInputsResult.fetchCalled, true, "runWorkflow should proceed when inputs is {}");
    assert.equal(
        emptyInputsResult.output,
        JSON.stringify({ status: "success", output: "ok" }),
        "runWorkflow should return the mocked success payload when inputs is {}",
    );

    console.log("Run workflow plugin tests passed");
}

main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PluginResult = {
    error?: string;
    fetches: string[];
    output?: unknown;
};

function runPluginTool(toolName: "listCronjobs" | "createCronjob" | "editCronjob" | "runCronjobNow", args: Record<string, unknown>, permissionStatus: "approved" | "rejected" = "approved"): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/manageCronjobs.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.MANAGE_CRONJOBS_PLUGIN_PATH;
const toolName = process.env.MANAGE_CRONJOBS_TOOL_NAME;
const toolArgs = JSON.parse(process.env.MANAGE_CRONJOBS_TOOL_ARGS || "{}");
const permissionStatus = process.env.MANAGE_CRONJOBS_PERMISSION_STATUS;
const mod = await import(pluginPath);
const fetches = [];

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
  fetches.push(urlString + " " + (options.method || "GET"));
  if (urlString.endsWith("/api/workflows/request-permission")) {
    return jsonResponse({ permission_id: "perm-1" });
  }
  if (urlString.endsWith("/api/workflows/permission-status/perm-1")) {
    return jsonResponse({ status: permissionStatus, approved: permissionStatus === "approved" });
  }
  if (urlString.endsWith("/api/cronjobs") && (options.method || "GET") === "GET") {
    return jsonResponse({ cronjobs: [{ id: "cron-1", name: "Daily summary" }] });
  }
  if (urlString.endsWith("/api/cronjobs") && options.method === "POST") {
    return jsonResponse({ cronjob: { id: "cron-1", name: "Daily summary" } });
  }
  if (urlString.endsWith("/api/cronjobs/cron-1") && options.method === "PATCH") {
    return jsonResponse({ cronjob: { id: "cron-1", name: "Updated summary" } });
  }
  if (urlString.endsWith("/api/cronjobs/cron-1/run-now") && options.method === "POST") {
    return jsonResponse({ run_id: "run-1", workflow_run_id: null });
  }
  throw new Error("Unexpected fetch: " + urlString + " " + (options.method || "GET"));
};

const hooks = await mod.ManageCronjobsPlugin({
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
  const output = await hooks.tool[toolName].execute(
    toolArgs,
    {
      directory: process.cwd(),
      sessionID: "child-session",
      messageID: "msg-1",
      callID: "call-1",
    }
  );
  console.log(JSON.stringify({ fetches, output: JSON.parse(output) }));
} catch (err) {
  console.log(JSON.stringify({
    fetches,
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
                MANAGE_CRONJOBS_PLUGIN_PATH: pluginUrl,
                MANAGE_CRONJOBS_TOOL_NAME: toolName,
                MANAGE_CRONJOBS_TOOL_ARGS: JSON.stringify(args),
                MANAGE_CRONJOBS_PERMISSION_STATUS: permissionStatus,
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
    const listResult = runPluginTool("listCronjobs", {});
    assert.equal(listResult.error, undefined);
    assert.deepEqual(listResult.output, { cronjobs: [{ id: "cron-1", name: "Daily summary" }] });
    assert.ok(listResult.fetches.includes("http://localhost:5124/api/cronjobs GET"));
    assert.ok(!listResult.fetches.includes("http://localhost:5124/api/workflows/request-permission POST"));

    const createResult = runPluginTool("createCronjob", {
        name: "Daily summary",
        enabled: true,
        target_type: "prompt",
        prompt: "Summarize repo status and mark the cronjob completed.",
        allow_workflow_runs_without_permission: true,
        cron_expression: "0 9 * * *",
        timezone: "UTC",
    });
    assert.equal(createResult.error, undefined);
    assert.deepEqual(createResult.output, { cronjob: { id: "cron-1", name: "Daily summary" } });
    assert.ok(createResult.fetches.includes("http://localhost:5124/api/workflows/request-permission POST"));
    assert.ok(createResult.fetches.includes("http://localhost:5124/api/cronjobs POST"));
    assert.ok(
        createResult.fetches.indexOf("http://localhost:5124/api/workflows/permission-status/perm-1 GET")
        < createResult.fetches.indexOf("http://localhost:5124/api/cronjobs POST"),
        "createCronjob must wait for permission before creating the cronjob",
    );

    const editResult = runPluginTool("editCronjob", {
        id: "cron-1",
        name: "Updated summary",
    });
    assert.equal(editResult.error, undefined);
    assert.deepEqual(editResult.output, { cronjob: { id: "cron-1", name: "Updated summary" } });
    assert.ok(editResult.fetches.includes("http://localhost:5124/api/cronjobs/cron-1 PATCH"));

    const runNowResult = runPluginTool("runCronjobNow", {
        id: "cron-1",
    });
    assert.equal(runNowResult.error, undefined);
    assert.deepEqual(runNowResult.output, { run_id: "run-1", workflow_run_id: null });
    assert.ok(runNowResult.fetches.includes("http://localhost:5124/api/cronjobs/cron-1/run-now POST"));

    const rejectedResult = runPluginTool("runCronjobNow", {
        id: "cron-1",
    }, "rejected");
    assert.equal(rejectedResult.error, "User denied permission to run this cronjob now.");
    assert.ok(!rejectedResult.fetches.includes("http://localhost:5124/api/cronjobs/cron-1/run-now POST"));

    const createMissingPrompt = runPluginTool("createCronjob", {
        name: "Missing prompt",
        enabled: true,
        target_type: "prompt",
        cron_expression: "0 9 * * *",
        timezone: "UTC",
    });
    assert.equal(createMissingPrompt.error, "prompt is required.");
    assert.equal(createMissingPrompt.fetches.length, 0);

    const createMissingWorkflowSlug = runPluginTool("createCronjob", {
        name: "Missing workflow slug",
        enabled: true,
        target_type: "workflow",
        workflow_inputs: {},
        cron_expression: "0 9 * * *",
        timezone: "UTC",
    });
    assert.equal(createMissingWorkflowSlug.error, "workflow_slug is required.");
    assert.equal(createMissingWorkflowSlug.fetches.length, 0);

    const editEmptyPatch = runPluginTool("editCronjob", {
        id: "cron-1",
    });
    assert.equal(editEmptyPatch.error, "At least one cronjob field must be provided to edit.");
    assert.equal(editEmptyPatch.fetches.length, 0);

    const runNowMissingId = runPluginTool("runCronjobNow", {
        id: "   ",
    });
    assert.equal(runNowMissingId.error, "id is required.");
    assert.equal(runNowMissingId.fetches.length, 0);

    console.log("Manage cronjobs plugin tests passed");
}

main();

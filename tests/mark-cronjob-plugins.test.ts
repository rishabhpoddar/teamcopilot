import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PluginResult = {
    error?: string;
    fetches: Array<{
        url: string;
        method: string;
        body: unknown;
        authorization: string | null;
    }>;
    output?: unknown;
};

function runMarkerPlugin(args: {
    pluginFileName: "markCronjobCompleted.ts" | "markCronjobFailed.ts";
    exportName: "MarkCronjobCompletedPlugin" | "MarkCronjobFailedPlugin";
    toolName: "markCronjobCompleted" | "markCronjobFailed";
    summary: string;
    responseStatus?: number;
    responseBody?: Record<string, unknown>;
}): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins", args.pluginFileName);
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.MARK_CRONJOB_PLUGIN_PATH;
const exportName = process.env.MARK_CRONJOB_EXPORT_NAME;
const toolName = process.env.MARK_CRONJOB_TOOL_NAME;
const summary = process.env.MARK_CRONJOB_SUMMARY || "";
const responseStatus = Number(process.env.MARK_CRONJOB_RESPONSE_STATUS || "200");
const responseBody = JSON.parse(process.env.MARK_CRONJOB_RESPONSE_BODY || '{"success":true}');
const mod = await import(pluginPath);
const fetches = [];

globalThis.fetch = async (url, options = {}) => {
  const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
  fetches.push({
    url: String(url),
    method: options.method || "GET",
    body,
    authorization: options.headers?.Authorization || options.headers?.authorization || null,
  });
  return {
    ok: responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  };
};

const hooks = await mod[exportName]({
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
    { summary },
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
                MARK_CRONJOB_PLUGIN_PATH: pluginUrl,
                MARK_CRONJOB_EXPORT_NAME: args.exportName,
                MARK_CRONJOB_TOOL_NAME: args.toolName,
                MARK_CRONJOB_SUMMARY: args.summary,
                MARK_CRONJOB_RESPONSE_STATUS: String(args.responseStatus ?? 200),
                MARK_CRONJOB_RESPONSE_BODY: JSON.stringify(args.responseBody ?? { success: true }),
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
    const completed = runMarkerPlugin({
        pluginFileName: "markCronjobCompleted.ts",
        exportName: "MarkCronjobCompletedPlugin",
        toolName: "markCronjobCompleted",
        summary: "  Finished nightly check.  ",
    });
    assert.equal(completed.error, undefined);
    assert.deepEqual(completed.output, { success: true, summary: "Finished nightly check." });
    assert.equal(completed.fetches.length, 1);
    assert.equal(completed.fetches[0].url, "http://localhost:5124/api/cronjobs/runs/complete-current");
    assert.equal(completed.fetches[0].method, "POST");
    assert.equal(completed.fetches[0].authorization, "Bearer root-session");
    assert.deepEqual(completed.fetches[0].body, { summary: "Finished nightly check." });

    const failed = runMarkerPlugin({
        pluginFileName: "markCronjobFailed.ts",
        exportName: "MarkCronjobFailedPlugin",
        toolName: "markCronjobFailed",
        summary: "  Missing credentials.  ",
    });
    assert.equal(failed.error, undefined);
    assert.deepEqual(failed.output, { success: true, summary: "Missing credentials." });
    assert.equal(failed.fetches.length, 1);
    assert.equal(failed.fetches[0].url, "http://localhost:5124/api/cronjobs/runs/fail-current");
    assert.deepEqual(failed.fetches[0].body, { summary: "Missing credentials." });

    const emptySummary = runMarkerPlugin({
        pluginFileName: "markCronjobCompleted.ts",
        exportName: "MarkCronjobCompletedPlugin",
        toolName: "markCronjobCompleted",
        summary: "   ",
    });
    assert.equal(emptySummary.error, "summary is required");
    assert.equal(emptySummary.fetches.length, 0);

    const apiError = runMarkerPlugin({
        pluginFileName: "markCronjobFailed.ts",
        exportName: "MarkCronjobFailedPlugin",
        toolName: "markCronjobFailed",
        summary: "Cannot continue",
        responseStatus: 404,
        responseBody: { message: "This is not a cronjob session." },
    });
    assert.equal(apiError.error, "This is not a cronjob session.");
    assert.equal(apiError.fetches.length, 1);

    console.log("Mark cronjob plugin tests passed");
}

main();

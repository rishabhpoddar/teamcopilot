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
    outputs: Record<string, unknown>;
};

function runPlugin(): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/manageCronjobTodos.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.MANAGE_TODO_PLUGIN_PATH;
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
  if (String(url).includes("/todos/not-completed")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ todos: [{ id: "todo-current", content: "Current todo", status: "in_progress", completionSummary: null }, { id: "todo-pending", content: "Pending todo", status: "pending", completionSummary: null }] }),
      text: async () => JSON.stringify({ todos: [{ id: "todo-current", content: "Current todo", status: "in_progress", completionSummary: null }, { id: "todo-pending", content: "Pending todo", status: "pending", completionSummary: null }] }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => JSON.stringify({ success: true }),
  };
};

const hooks = await mod.ManageCronjobTodosPlugin({
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

async function run() {
  const outputs = {};
  outputs.add = JSON.parse(await hooks.tool.addCronjobTodos.execute({ items: ["Inserted"], index: 1 }, {
    directory: process.cwd(),
    sessionID: "child-session",
    messageID: "msg-1",
    callID: "call-1",
  }));
  outputs.clear = JSON.parse(await hooks.tool.clearCronjobTodos.execute({ todo_ids: ["todo-pending"] }, {
    directory: process.cwd(),
    sessionID: "child-session",
    messageID: "msg-1",
    callID: "call-1",
  }));
  outputs.current = JSON.parse(await hooks.tool.getCurrentCronjobTodo.execute({}, {
    directory: process.cwd(),
    sessionID: "child-session",
    messageID: "msg-1",
    callID: "call-1",
  }));
  outputs.list = JSON.parse(await hooks.tool.getCronjobTodos.execute({}, {
    directory: process.cwd(),
    sessionID: "child-session",
    messageID: "msg-1",
    callID: "call-1",
  }));
  outputs.finish = JSON.parse(await hooks.tool.finishCurrentCronjobTodo.execute({ completionSummary: "Done" }, {
    directory: process.cwd(),
    sessionID: "child-session",
    messageID: "msg-1",
    callID: "call-1",
  }));
  console.log(JSON.stringify({ fetches, outputs }));
}

await run();
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                MANAGE_TODO_PLUGIN_PATH: pluginUrl,
            },
        },
    );

    if (result.status !== 0) {
        throw new Error(`Subprocess failed (${result.status}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
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
    const result = runPlugin();
    assert.equal(result.error, undefined);
    assert.equal(result.fetches.length, 5);
    assert.equal(result.fetches[0].url, "http://localhost:5124/api/cronjobs/runs/todos/add");
    assert.equal(result.fetches[1].url, "http://localhost:5124/api/cronjobs/runs/todos/clear");
    assert.equal(result.fetches[2].url, "http://localhost:5124/api/cronjobs/runs/todos/not-completed");
    assert.equal(result.fetches[3].url, "http://localhost:5124/api/cronjobs/runs/todos/not-completed");
    assert.equal(result.fetches[4].url, "http://localhost:5124/api/cronjobs/runs/todos/finish-current");
    assert.equal(result.fetches[0].authorization, "Bearer root-session");
    assert.deepEqual(result.fetches[0].body, { items: ["Inserted"], index: 1 });
    assert.deepEqual(result.fetches[1].body, { todo_ids: ["todo-pending"] });
    assert.deepEqual(result.outputs.current, { todo: { id: "todo-current", content: "Current todo", status: "in_progress", completionSummary: null } });
    assert.deepEqual(result.outputs.list, { todos: [{ id: "todo-current", content: "Current todo", status: "in_progress", completionSummary: null }, { id: "todo-pending", content: "Pending todo", status: "pending", completionSummary: null }] });

    console.log("Manage cronjob todos plugin tests passed");
}

main();

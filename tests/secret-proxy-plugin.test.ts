import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ToolCase = {
    kind: "tool";
    input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> };
    output: { args: Record<string, unknown> };
};

type HookResult = {
    command?: string;
    cmd?: string;
    commandInput?: string;
    fetchCalls: Array<{ authorization: string; text: string }>;
    error?: string;
};

function runToolCase(pluginCase: ToolCase): HookResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/secret-proxy.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.SECRET_PROXY_PLUGIN_PATH;
const payload = JSON.parse(process.env.SECRET_PROXY_CASE_JSON || "{}");
const mod = await import(pluginPath);
const fetchCalls = [];
globalThis.fetch = async (_url, options = {}) => {
  const headers = options.headers ?? {};
  const authorization = typeof headers.Authorization === "string"
    ? headers.Authorization
    : typeof headers.authorization === "string"
      ? headers.authorization
      : "";
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  fetchCalls.push({ authorization, text: body.text ?? "" });
  if (body.text === "echo {{SECRET:MISSING_KEY}}") {
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying." }),
    };
  }
  return {
    ok: true,
    json: async () => ({ substituted_text: body.text.replace("{{SECRET:OPENAI_API_KEY}}", "resolved-secret-value") }),
    text: async () => "",
  };
};
const hooks = await mod.SecretProxyPlugin({
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
  await hooks["tool.execute.before"](payload.input, payload.output);
  console.log(JSON.stringify({
    command: payload.output.args.command,
    cmd: payload.output.args.cmd,
    commandInput: payload.input.args?.command,
    fetchCalls,
  }));
} catch (err) {
  console.log(JSON.stringify({
    command: payload.output.args.command,
    cmd: payload.output.args.cmd,
    commandInput: payload.input.args?.command,
    fetchCalls,
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
                SECRET_PROXY_PLUGIN_PATH: pluginUrl,
                SECRET_PROXY_CASE_JSON: JSON.stringify(pluginCase),
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

function main(): void {
    const resolved = runToolCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c1",
            args: { command: "echo {{SECRET:OPENAI_API_KEY}}" },
        },
        output: {
            args: { command: "echo {{SECRET:OPENAI_API_KEY}}" },
        },
    });
    assert.equal(resolved.command, "echo resolved-secret-value", "replaces placeholder-based bash command just before execution");
    assert.deepEqual(
        resolved.fetchCalls,
        [{ authorization: "Bearer root-session", text: "echo {{SECRET:OPENAI_API_KEY}}" }],
        "resolves placeholders using the root session token",
    );

    const missing = runToolCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c2",
            args: { command: "echo {{SECRET:MISSING_KEY}}" },
        },
        output: {
            args: { command: "echo {{SECRET:MISSING_KEY}}" },
        },
    });
    assert.equal(
        missing.error,
        "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
        "returns a clear error when a referenced secret is missing",
    );

    const untouched = runToolCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c3",
            args: { command: "echo hello" },
        },
        output: {
            args: { command: "echo hello" },
        },
    });
    assert.equal(untouched.command, "echo hello", "leaves plain bash commands unchanged");
    assert.deepEqual(untouched.fetchCalls, [], "skips secret resolution when no placeholders are present");

    console.log("Secret proxy plugin tests passed");
}

main();

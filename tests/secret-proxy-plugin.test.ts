import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ToolCase = {
    kind: "tool";
    input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> };
    output: { args: Record<string, unknown> };
};

type CommandCase = {
    kind: "command";
    input: { command: string; arguments: string; sessionID: string };
    output: { parts: unknown[] };
};

type HookCase = ToolCase | CommandCase;

type FetchCall = {
    authorization: string;
    keys: string[];
};

type HookResult = {
    input: HookCase["input"];
    output: HookCase["output"];
    fetchCalls: FetchCall[];
    shellEnv: Record<string, string>;
    error?: string;
};

type MultiHookStepResult = {
    input: HookCase["input"];
    output: HookCase["output"];
    shellEnv: Record<string, string>;
    error?: string;
};

type MultiHookResult = {
    steps: MultiHookStepResult[];
    fetchCalls: FetchCall[];
};

function runHookCase(pluginCase: HookCase): HookResult {
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
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key) => typeof key === "string").map((key) => String(key).trim().toUpperCase())
    : [];
  fetchCalls.push({ authorization, keys });

  const missingKeys = keys.filter((key) => key.startsWith("MISSING_"));
  if (missingKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        message: "This command references missing secrets: " + missingKeys.join(", ") + ". Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."
      }),
    };
  }

  if (keys.includes("API_FAIL")) {
    return {
      ok: false,
      status: 500,
      text: async () => "Internal secret resolution failure",
    };
  }

  const secretMap = {};
  for (const key of keys) {
    secretMap[key] = "resolved-" + key.toLowerCase();
  }

  return {
    ok: true,
    json: async () => ({ secret_map: secretMap }),
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
        if (path.id === "bad-session") {
          return { error: { message: "Session lookup failed from API" } };
        }
        if (path.id === "grandchild-session") {
          return { data: { id: "grandchild-session", parentID: "child-session" } };
        }
        if (path.id === "child-session") {
          return { data: { id: "child-session", parentID: "root-session" } };
        }
        return { data: { id: path.id, parentID: null } };
      },
    },
  },
});

const shellOutput = { env: {} };

try {
  if (payload.kind === "tool") {
    await hooks["tool.execute.before"](payload.input, payload.output);
    await hooks["shell.env"](
      {
        sessionID: payload.input.sessionID,
        cwd: process.cwd(),
        callID: payload.input.callID,
      },
      shellOutput
    );
  } else {
    await hooks["command.execute.before"](payload.input, payload.output);
    await hooks["shell.env"](
      {
        sessionID: payload.input.sessionID,
        cwd: process.cwd(),
      },
      shellOutput
    );
  }
  console.log(JSON.stringify({ input: payload.input, output: payload.output, fetchCalls, shellEnv: shellOutput.env }));
} catch (err) {
  console.log(JSON.stringify({
    input: payload.input,
    output: payload.output,
    fetchCalls,
    shellEnv: shellOutput.env,
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

function runHookSequence(pluginCases: HookCase[]): MultiHookResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/secret-proxy.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.SECRET_PROXY_PLUGIN_PATH;
const payload = JSON.parse(process.env.SECRET_PROXY_CASE_JSON || "[]");
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
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key) => typeof key === "string").map((key) => String(key).trim().toUpperCase())
    : [];
  fetchCalls.push({ authorization, keys });

  const missingKeys = keys.filter((key) => key.startsWith("MISSING_"));
  if (missingKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        message: "This command references missing secrets: " + missingKeys.join(", ") + ". Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."
      }),
    };
  }

  const secretMap = {};
  for (const key of keys) {
    secretMap[key] = "resolved-" + key.toLowerCase();
  }

  return {
    ok: true,
    json: async () => ({ secret_map: secretMap }),
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

const steps = [];
for (const hookCase of payload) {
  const shellOutput = { env: {} };
  try {
    if (hookCase.kind === "tool") {
      await hooks["tool.execute.before"](hookCase.input, hookCase.output);
      await hooks["shell.env"](
        {
          sessionID: hookCase.input.sessionID,
          cwd: process.cwd(),
          callID: hookCase.input.callID,
        },
        shellOutput
      );
    } else {
      await hooks["command.execute.before"](hookCase.input, hookCase.output);
      await hooks["shell.env"](
        {
          sessionID: hookCase.input.sessionID,
          cwd: process.cwd(),
        },
        shellOutput
      );
    }
    steps.push({ input: hookCase.input, output: hookCase.output, shellEnv: shellOutput.env });
  } catch (err) {
    steps.push({
      input: hookCase.input,
      output: hookCase.output,
      shellEnv: shellOutput.env,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

console.log(JSON.stringify({ steps, fetchCalls }));
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
                SECRET_PROXY_CASE_JSON: JSON.stringify(pluginCases),
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

    return JSON.parse(jsonLine) as MultiHookResult;
}

function assertNoFetch(result: HookResult, label: string): void {
    assert.deepEqual(result.fetchCalls, [], label);
}

function assertFetchKeys(result: HookResult, expectedKeys: string[], label: string): void {
    assert.deepEqual(
        result.fetchCalls,
        [{ authorization: "Bearer root-session", keys: expectedKeys }],
        label,
    );
}

function expectedWrappedCommand(command: string): string {
    return command;
}

function expectedWrappedArguments(command: string): string {
    if (command.startsWith("curl ")) {
        return command.slice("curl ".length);
    }
    if (command.startsWith("git ")) {
        return command.slice("git ".length);
    }
    return command;
}

function runExecutedCurlCase(command: string): {
    rewrittenCommand: string;
    shellEnv: Record<string, string>;
    stdout: string;
    stderr: string;
    status: number | null;
    receivedPrivateToken: string | null;
} {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/secret-proxy.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const pluginPath = process.env.SECRET_PROXY_PLUGIN_PATH;
const command = process.env.SECRET_PROXY_EXECUTE_COMMAND || "";
const mod = await import(pluginPath);

globalThis.fetch = async (_url, options = {}) => {
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key) => typeof key === "string").map((key) => String(key).trim().toUpperCase())
    : [];
  const secretMap = {};
  for (const key of keys) {
    secretMap[key] = "resolved-" + key.toLowerCase();
  }
  return {
    ok: true,
    json: async () => ({ secret_map: secretMap }),
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
      get: async ({ path }) => path.id === "child-session"
        ? { data: { id: "child-session", parentID: "root-session" } }
        : { data: { id: path.id, parentID: null } },
    },
  },
});

const serverState = { privateToken: null };
const server = http.createServer((req, res) => {
  const rawHeader = req.headers["private-token"];
  const privateToken = Array.isArray(rawHeader) ? rawHeader[0] ?? null : rawHeader ?? null;
  serverState.privateToken = privateToken;
  res.statusCode = privateToken === "resolved-gitlab_token" ? 200 : 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: privateToken === "resolved-gitlab_token" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address !== "object") {
  throw new Error("Failed to bind local test server");
}
const url = "http://127.0.0.1:" + address.port + "/user";
const pluginCase = {
  kind: "tool",
  input: { tool: "bash", sessionID: "child-session", callID: "exec-1", args: { command: command.replace("https://api.example.test/user", url) } },
  output: { args: { command: command.replace("https://api.example.test/user", url) } },
};

await hooks["tool.execute.before"](pluginCase.input, pluginCase.output);
const shellOutput = { env: {} };
await hooks["shell.env"](
  {
    sessionID: "child-session",
    cwd: process.cwd(),
    callID: "exec-1",
  },
  shellOutput
);

const executionResult = await new Promise((resolve, reject) => {
  const child = spawn("bash", ["-lc", pluginCase.output.args.command], {
    env: {
      ...process.env,
      ...shellOutput.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", reject);
  child.on("close", (status) => {
    resolve({ stdout, stderr, status });
  });
});

await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

console.log(JSON.stringify({
  rewrittenCommand: pluginCase.output.args.command,
  shellEnv: shellOutput.env,
  stdout: executionResult.stdout,
  stderr: executionResult.stderr,
  status: executionResult.status,
  receivedPrivateToken: serverState.privateToken,
}));
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
                SECRET_PROXY_EXECUTE_COMMAND: command,
            },
        },
    );

    if (result.status !== 0) {
        throw new Error(
            `Execution subprocess failed (${result.status}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    }

    const lines = (result.stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(jsonLine, `Missing JSON output from subprocess.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    return JSON.parse(jsonLine) as {
        rewrittenCommand: string;
        shellEnv: Record<string, string>;
        stdout: string;
        stderr: string;
        status: number | null;
        receivedPrivateToken: string | null;
    };
}

async function main(): Promise<void> {
    let assertions = 0;

    const curlCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1", args: { command: "curl https://api.example.com/{{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "curl https://api.example.com/{{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((curlCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl https://api.example.com/${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}")); assertions += 1;
    assert.equal((curlCommand.input as ToolCase["input"]).args?.command, expectedWrappedCommand("curl https://api.example.com/${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}")); assertions += 1;
    assertFetchKeys(curlCommand, ["OPENAI_API_KEY"], "injects env only for referenced curl URL secrets"); assertions += 1;
    assert.deepEqual(curlCommand.shellEnv, { __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY: "resolved-openai_api_key" }); assertions += 1;

    const gitCloneCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1g", args: { command: "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((gitCloneCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git")); assertions += 1;
    assertFetchKeys(gitCloneCommand, ["GITHUB_TOKEN"], "injects env for git clone private repo URL secrets"); assertions += 1;
    assert.deepEqual(gitCloneCommand.shellEnv, { __TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN: "resolved-github_token" }); assertions += 1;

    const gitPushCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1h", args: { command: "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push origin main" } },
        output: { args: { command: "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push origin main" } },
    });
    assert.equal((gitPushCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("git -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" push origin main")); assertions += 1;
    assertFetchKeys(gitPushCommand, ["GITHUB_TOKEN"], "injects env for git config header secrets used by push"); assertions += 1;

    const gitCloneSingleQuotedUrl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1i", args: { command: "git clone 'https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/private-repo.git'" } },
        output: { args: { command: "git clone 'https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/private-repo.git'" } },
    });
    assert.equal((gitCloneSingleQuotedUrl.output as ToolCase["output"]).args.command, expectedWrappedCommand("git clone \"https://oauth2:${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}@gitlab.com/acme/private-repo.git\"")); assertions += 1;
    assertFetchKeys(gitCloneSingleQuotedUrl, ["GITLAB_TOKEN"], "converts single-quoted git clone URL tokens to double quotes for env expansion"); assertions += 1;

    const gitRemoteSetUrl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1j", args: { command: "git remote set-url origin https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "git remote set-url origin https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((gitRemoteSetUrl.output as ToolCase["output"]).args.command, expectedWrappedCommand("git remote set-url origin https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git")); assertions += 1;
    assertFetchKeys(gitRemoteSetUrl, ["GITHUB_TOKEN"], "injects env for git remote set-url secrets"); assertions += 1;

    const gitFetchConfigHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1k", args: { command: "git -c http.https://github.com/.extraheader='AUTHORIZATION: basic {{SECRET:GITHUB_TOKEN}}' fetch origin main" } },
        output: { args: { command: "git -c http.https://github.com/.extraheader='AUTHORIZATION: basic {{SECRET:GITHUB_TOKEN}}' fetch origin main" } },
    });
    assert.equal((gitFetchConfigHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("git -c \"http.https://github.com/.extraheader=AUTHORIZATION: basic ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" fetch origin main")); assertions += 1;
    assertFetchKeys(gitFetchConfigHeader, ["GITHUB_TOKEN"], "injects env for git scoped extraheader secrets"); assertions += 1;

    const gitCommitAuthor = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1l", args: { command: "git -c user.email='bot+{{SECRET:GITHUB_TOKEN}}@example.com' commit -m 'sync private repo'" } },
        output: { args: { command: "git -c user.email='bot+{{SECRET:GITHUB_TOKEN}}@example.com' commit -m 'sync private repo'" } },
    });
    assert.equal((gitCommitAuthor.output as ToolCase["output"]).args.command, expectedWrappedCommand("git -c \"user.email=bot+${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@example.com\" commit -m 'sync private repo'")); assertions += 1;
    assertFetchKeys(gitCommitAuthor, ["GITHUB_TOKEN"], "injects env for git commit-related config values"); assertions += 1;

    const gitMultipleSecrets = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1m", args: { command: "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/repo.git main" } },
        output: { args: { command: "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/repo.git main" } },
    });
    assert.equal((gitMultipleSecrets.output as ToolCase["output"]).args.command, expectedWrappedCommand("git -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" push https://oauth2:${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}@gitlab.com/acme/repo.git main")); assertions += 1;
    assertFetchKeys(gitMultipleSecrets, ["GITHUB_TOKEN", "GITLAB_TOKEN"], "injects env for multiple git placeholders in one command"); assertions += 1;
    assert.deepEqual(gitMultipleSecrets.shellEnv, {
        __TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN: "resolved-github_token",
        __TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN: "resolved-gitlab_token",
    }); assertions += 1;

    const gitPathExecutable = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "grandchild-session", callID: "1n", args: { command: "/usr/bin/git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "/usr/bin/git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((gitPathExecutable.output as ToolCase["output"]).args.command, expectedWrappedCommand("/usr/bin/git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git")); assertions += 1;
    assertFetchKeys(gitPathExecutable, ["GITHUB_TOKEN"], "injects env for path-qualified git executable tokens"); assertions += 1;

    const chainedGitCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1o", args: { command: "echo before && git push https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git main && echo after" } },
        output: { args: { command: "echo before && git push https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git main && echo after" } },
    });
    assert.equal((chainedGitCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("echo before && git push https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git main && echo after")); assertions += 1;
    assertFetchKeys(chainedGitCommand, ["GITHUB_TOKEN"], "injects env for chained git command segments"); assertions += 1;

    const mixedCurlAndGitCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1p", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((mixedCurlAndGitCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com && git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git")); assertions += 1;
    assertFetchKeys(mixedCurlAndGitCommand, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "injects env for mixed curl and git shell segments"); assertions += 1;

    const multilineGitCommand = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "1q",
            args: {
                command: "git \\\n  -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' \\\n  fetch origin main",
            },
        },
        output: {
            args: {
                command: "git \\\n  -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' \\\n  fetch origin main",
            },
        },
    });
    assert.equal(
        (multilineGitCommand.output as ToolCase["output"]).args.command,
        expectedWrappedCommand("git \\\n  -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" \\\n  fetch origin main"),
    ); assertions += 1;
    assertFetchKeys(multilineGitCommand, ["GITHUB_TOKEN"], "preserves multiline git formatting and line continuations"); assertions += 1;

    const nestedGitString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1r", args: { command: "echo ok" } },
        output: { args: { metadata: { nested: "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } } },
    });
    assert.equal(((nestedGitString.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git"); assertions += 1;
    assertFetchKeys(nestedGitString, ["GITHUB_TOKEN"], "injects env for nested git strings"); assertions += 1;

    const arrayGitString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1s", args: { command: "echo ok" } },
        output: { args: { parts: ["git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git", "echo {{SECRET:OPENAI_API_KEY}}"] } },
    });
    assert.deepEqual((arrayGitString.output as ToolCase["output"]).args.parts, ["git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git", "echo {{SECRET:OPENAI_API_KEY}}"]); assertions += 1;
    assertFetchKeys(arrayGitString, ["GITHUB_TOKEN"], "injects env only for git strings inside arrays"); assertions += 1;

    const gitInRepositoryNameOnly = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1t", args: { command: "echo cloning git-private-repo-{{SECRET:GITHUB_TOKEN}}" } },
        output: { args: { command: "echo cloning git-private-repo-{{SECRET:GITHUB_TOKEN}}" } },
    });
    assert.equal((gitInRepositoryNameOnly.output as ToolCase["output"]).args.command, "echo cloning git-private-repo-{{SECRET:GITHUB_TOKEN}}"); assertions += 1;
    assertNoFetch(gitInRepositoryNameOnly, "does not inject when git appears only inside a non-git argument"); assertions += 1;

    const quotedGitNotExecutable = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1u", args: { command: "echo 'git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'" } },
        output: { args: { command: "echo 'git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'" } },
    });
    assert.equal((quotedGitNotExecutable.output as ToolCase["output"]).args.command, "echo 'git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'"); assertions += 1;
    assertNoFetch(quotedGitNotExecutable, "does not inject when git command text is quoted data for another command"); assertions += 1;

    const nestedBashLcGit = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1v", args: { command: "bash -lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\"" } },
        output: { args: { command: "bash -lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\"" } },
    });
    assert.equal((nestedBashLcGit.output as ToolCase["output"]).args.command, "bash -lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\""); assertions += 1;
    assertNoFetch(nestedBashLcGit, "does not rewrite nested git embedded in bash -lc"); assertions += 1;

    const gitLikeExecutableName = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1w", args: { command: "git-lfs fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "git-lfs fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((gitLikeExecutableName.output as ToolCase["output"]).args.command, "git-lfs fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git"); assertions += 1;
    assertNoFetch(gitLikeExecutableName, "does not inject for git-like executable names that are not exactly git"); assertions += 1;

    const uppercaseGitExecutable = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1x", args: { command: "GIT clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "GIT clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((uppercaseGitExecutable.output as ToolCase["output"]).args.command, "GIT clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git"); assertions += 1;
    assertNoFetch(uppercaseGitExecutable, "does not inject for uppercase GIT executable token"); assertions += 1;

    const gitPlaceholderInCommandName = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1y", args: { command: "git-{{SECRET:GITHUB_TOKEN}} status" } },
        output: { args: { command: "git-{{SECRET:GITHUB_TOKEN}} status" } },
    });
    assert.equal((gitPlaceholderInCommandName.output as ToolCase["output"]).args.command, "git-{{SECRET:GITHUB_TOKEN}} status"); assertions += 1;
    assertNoFetch(gitPlaceholderInCommandName, "does not inject when placeholder is in a git-like command name"); assertions += 1;

    const nonBashGitTool = runHookCase({
        kind: "tool",
        input: { tool: "task", sessionID: "child-session", callID: "1z", args: { command: "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((nonBashGitTool.output as ToolCase["output"]).args.command, "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git"); assertions += 1;
    assertNoFetch(nonBashGitTool, "does not run git secret injection on non-bash tools"); assertions += 1;

    const curlHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "2", args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((curlHeader.output as ToolCase["output"]).args.cmd, expectedWrappedCommand("curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com")); assertions += 1;
    assertFetchKeys(curlHeader, ["API_TOKEN"], "injects env for supported curl header secrets"); assertions += 1;
    assert.deepEqual(curlHeader.shellEnv, { __TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN: "resolved-api_token" }); assertions += 1;

    const inlineHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "3", args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
        output: { args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
    });
    assert.equal((inlineHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl --header=Authorization:Bearer-${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN} https://example.com")); assertions += 1;
    assertFetchKeys(inlineHeader, ["API_TOKEN"], "injects env for inline curl headers"); assertions += 1;

    const dataOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4", args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
    });
    assert.equal((dataOption.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -d \"{\\\"token\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com")); assertions += 1;
    assertFetchKeys(dataOption, ["OPENAI_API_KEY"], "injects env for curl data payload placeholders"); assertions += 1;

    const allowedCookieHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4b", args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((allowedCookieHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"Cookie: session=${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com")); assertions += 1;
    assertFetchKeys(allowedCookieHeader, ["API_TOKEN"], "injects env for cookie header substitution"); assertions += 1;

    const gitlabPrivateTokenHeader = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "4c",
            args: { command: "curl -i -H \"PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}\" \"https://api.example.test/user\"" },
        },
        output: {
            args: { command: "curl -i -H \"PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}\" \"https://api.example.test/user\"" },
        },
    });
    assert.equal(
        (gitlabPrivateTokenHeader.output as ToolCase["output"]).args.command,
        expectedWrappedCommand("curl -i -H \"PRIVATE-TOKEN: ${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}\" \"https://api.example.test/user\""),
    ); assertions += 1;
    assertFetchKeys(gitlabPrivateTokenHeader, ["GITLAB_TOKEN"], "injects env for GitLab PRIVATE-TOKEN header substitution"); assertions += 1;
    assert.deepEqual(gitlabPrivateTokenHeader.shellEnv, { __TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN: "resolved-gitlab_token" }); assertions += 1;

    const userOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "5", args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
        output: { args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
    });
    assert.equal((userOption.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -u user:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN} https://example.com")); assertions += 1;
    assertFetchKeys(userOption, ["GITHUB_TOKEN"], "injects env for curl -u values"); assertions += 1;

    const formOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6", args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
    });
    assert.equal((formOption.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -F \"token=${__TEAMCOPILOT_RUNTIME_SECRET_SLACK_TOKEN}\" https://example.com")); assertions += 1;
    assertFetchKeys(formOption, ["SLACK_TOKEN"], "injects env for curl form values"); assertions += 1;

    const doubleQuotedHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6a", args: { command: "curl -H \"Authorization: Bearer {{SECRET:API_TOKEN}}\" https://example.com" } },
        output: { args: { command: "curl -H \"Authorization: Bearer {{SECRET:API_TOKEN}}\" https://example.com" } },
    });
    assert.equal((doubleQuotedHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com")); assertions += 1;
    assertFetchKeys(doubleQuotedHeader, ["API_TOKEN"], "preserves double quotes when rewriting supported header tokens"); assertions += 1;

    const singleQuotedUrl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6b", args: { command: "curl 'https://api.example.com/{{SECRET:OPENAI_API_KEY}}?mode=full&debug=1'" } },
        output: { args: { command: "curl 'https://api.example.com/{{SECRET:OPENAI_API_KEY}}?mode=full&debug=1'" } },
    });
    assert.equal((singleQuotedUrl.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl \"https://api.example.com/${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}?mode=full&debug=1\"")); assertions += 1;
    assertFetchKeys(singleQuotedUrl, ["OPENAI_API_KEY"], "converts single-quoted curl URL tokens to double quotes for env expansion"); assertions += 1;

    const multilineCurlHeader = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "6b-1",
            args: {
                command: "curl -sS \\\n  -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' \\\n  \"https://example.com\"",
            },
        },
        output: {
            args: {
                command: "curl -sS \\\n  -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' \\\n  \"https://example.com\"",
            },
        },
    });
    assert.equal(
        (multilineCurlHeader.output as ToolCase["output"]).args.command,
        expectedWrappedCommand("curl -sS \\\n  -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" \\\n  \"https://example.com\""),
    ); assertions += 1;
    assertFetchKeys(multilineCurlHeader, ["API_TOKEN"], "preserves multiline curl header formatting and line continuations"); assertions += 1;

    const multilineCurlData = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "6b-2",
            args: {
                command: "curl \\\n    -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' \\\n    https://example.com",
            },
        },
        output: {
            args: {
                command: "curl \\\n    -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' \\\n    https://example.com",
            },
        },
    });
    assert.equal(
        (multilineCurlData.output as ToolCase["output"]).args.command,
        expectedWrappedCommand("curl \\\n    -d \"{\\\"token\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" \\\n    https://example.com"),
    ); assertions += 1;
    assertFetchKeys(multilineCurlData, ["OPENAI_API_KEY"], "preserves multiline curl data formatting and indentation"); assertions += 1;

    const commandHookMultilineCurl = runHookCase({
        kind: "command",
        input: {
            command: "curl",
            arguments: "-sS \\\n  -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' \\\n  https://example.com",
            sessionID: "child-session",
        },
        output: { parts: [] },
    });
    assert.equal((commandHookMultilineCurl.input as CommandCase["input"]).command, "curl"); assertions += 1;
    assert.equal(
        (commandHookMultilineCurl.input as CommandCase["input"]).arguments,
        expectedWrappedArguments("curl -sS \\\n  -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" \\\n  https://example.com"),
    ); assertions += 1;
    assertFetchKeys(commandHookMultilineCurl, ["API_TOKEN"], "preserves multiline curl formatting in command hook arguments"); assertions += 1;

    const multiPlaceholderAllowedHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6c", args: { command: "curl -H 'X-Api-Key: a={{SECRET:OPENAI_API_KEY}};b={{SECRET:GITHUB_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: a={{SECRET:OPENAI_API_KEY}};b={{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assert.equal((multiPlaceholderAllowedHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"X-Api-Key: a=${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY};b=${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" https://example.com")); assertions += 1;
    assertFetchKeys(multiPlaceholderAllowedHeader, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "rewrites multiple placeholders inside one allowed single-quoted header token"); assertions += 1;

    const multiPlaceholderJsonData = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6d", args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\",\"backup\":\"{{SECRET:GITHUB_TOKEN}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\",\"backup\":\"{{SECRET:GITHUB_TOKEN}}\"}' https://example.com" } },
    });
    assert.equal((multiPlaceholderJsonData.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -d \"{\\\"token\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\",\\\"backup\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\\\"}\" https://example.com")); assertions += 1;
    assertFetchKeys(multiPlaceholderJsonData, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "rewrites multiple placeholders inside single-quoted JSON payloads"); assertions += 1;

    const backtickEscapingHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6e", args: { command: "curl -H 'X-Api-Key: prefix`{{SECRET:OPENAI_API_KEY}}`suffix' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: prefix`{{SECRET:OPENAI_API_KEY}}`suffix' https://example.com" } },
    });
    assert.equal((backtickEscapingHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"X-Api-Key: prefix\\`${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\`suffix\" https://example.com")); assertions += 1;
    assertFetchKeys(backtickEscapingHeader, ["OPENAI_API_KEY"], "escapes backticks when converting single-quoted header tokens to double quotes"); assertions += 1;

    const backslashEscapingHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6f", args: { command: "curl -H 'X-Api-Key: path\\\\{{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: path\\\\{{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((backslashEscapingHeader.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"X-Api-Key: path\\\\\\\\${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com")); assertions += 1;
    assertFetchKeys(backslashEscapingHeader, ["OPENAI_API_KEY"], "escapes backslashes when converting single-quoted header tokens to double quotes"); assertions += 1;

    const embeddedDoubleQuoteEscaping = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6g", args: { command: "curl -d '{\"note\":\"say \\\"hi\\\" to {{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"note\":\"say \\\"hi\\\" to {{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
    });
    assert.equal((embeddedDoubleQuoteEscaping.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -d \"{\\\"note\\\":\\\"say \\\\\\\"hi\\\\\\\" to ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com")); assertions += 1;
    assertFetchKeys(embeddedDoubleQuoteEscaping, ["OPENAI_API_KEY"], "keeps embedded escaped double quotes valid after single-quote to double-quote conversion"); assertions += 1;

    const unsafeOutputOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "7", args: { command: "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com" } },
        output: { args: { command: "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com" } },
    });
    assert.equal((unsafeOutputOption.output as ToolCase["output"]).args.command, "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com"); assertions += 1;
    assertNoFetch(unsafeOutputOption, "does not resolve unsafe curl output placeholders"); assertions += 1;
    assert.deepEqual(unsafeOutputOption.shellEnv, {}); assertions += 1;

    const mixedSafeUnsafe = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "9",
            args: { command: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com" },
        },
        output: {
            args: { command: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com" },
        },
    });
    assert.equal((mixedSafeUnsafe.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" --output {{SECRET:GITHUB_TOKEN}} https://example.com")); assertions += 1;
    assertFetchKeys(mixedSafeUnsafe, ["OPENAI_API_KEY"], "injects env only for safe mixed curl placeholders"); assertions += 1;

    const echoCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "10", args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((echoCommand.output as ToolCase["output"]).args.command, "echo {{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(echoCommand, "does not resolve non-curl placeholders"); assertions += 1;

    const nestedCurlString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "12", args: { command: "echo ok" } },
        output: { args: { metadata: { nested: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } } },
    });
    assert.equal(((nestedCurlString.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com"); assertions += 1;
    assertFetchKeys(nestedCurlString, ["OPENAI_API_KEY"], "injects env for nested curl strings"); assertions += 1;

    const arrayCurlString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "13", args: { command: "echo ok" } },
        output: { args: { parts: ["curl https://example.com/{{SECRET:OPENAI_API_KEY}}", "echo {{SECRET:GITHUB_TOKEN}}"] } },
    });
    assert.deepEqual((arrayCurlString.output as ToolCase["output"]).args.parts, ["curl https://example.com/${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}", "echo {{SECRET:GITHUB_TOKEN}}"]); assertions += 1;
    assertFetchKeys(arrayCurlString, ["OPENAI_API_KEY"], "injects env only for curl strings inside arrays"); assertions += 1;

    const differentHeaderStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "15", args: { command: "echo ok" } },
        output: { args: { one: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", two: "curl -H 'X-Api-Key: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assertFetchKeys(differentHeaderStrings, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "injects env for all distinct supported keys in one pass"); assertions += 1;
    assert.deepEqual(differentHeaderStrings.shellEnv, {
        __TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN: "resolved-github_token",
        __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY: "resolved-openai_api_key",
    }); assertions += 1;

    const chainedCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "17", args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
        output: { args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
    });
    assert.equal((chainedCommand.output as ToolCase["output"]).args.command, expectedWrappedCommand("echo start && curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com && echo done")); assertions += 1;
    assertFetchKeys(chainedCommand, ["OPENAI_API_KEY"], "injects env for chained curl segments"); assertions += 1;

    const pathToCurl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "grandchild-session", callID: "20", args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((pathToCurl.output as ToolCase["output"]).args.command, expectedWrappedCommand("/usr/bin/curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com")); assertions += 1;
    assertFetchKeys(pathToCurl, ["OPENAI_API_KEY"], "resolves root session through multiple parents for shell env"); assertions += 1;

    const nonBashTool = runHookCase({
        kind: "tool",
        input: { tool: "task", sessionID: "child-session", callID: "21", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((nonBashTool.output as ToolCase["output"]).args.command, "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(nonBashTool, "does not run on non-bash tools"); assertions += 1;

    const missingInputArgs = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "21a" },
        output: { args: { command: "curl -H 'PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}' https://example.com" } },
    });
    assert.equal(
        (missingInputArgs.output as ToolCase["output"]).args.command,
        expectedWrappedCommand("curl -H \"PRIVATE-TOKEN: ${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}\" https://example.com"),
    ); assertions += 1;
    assertFetchKeys(missingInputArgs, ["GITLAB_TOKEN"], "rewrites output args even when input.args is missing"); assertions += 1;

    const missingOutputArgs = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "21b", args: { command: "curl -H 'PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}' https://example.com" } },
        output: { args: {} },
    });
    assert.equal(
        (missingOutputArgs.input as ToolCase["input"]).args?.command,
        expectedWrappedCommand("curl -H \"PRIVATE-TOKEN: ${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}\" https://example.com"),
    ); assertions += 1;
    assertFetchKeys(missingOutputArgs, ["GITLAB_TOKEN"], "still injects env when only input.args carries the rewritten command"); assertions += 1;

    const commandExecutableCurl = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableCurl.input as CommandCase["input"]).command, "curl"); assertions += 1;
    assert.equal((commandExecutableCurl.input as CommandCase["input"]).arguments, expectedWrappedArguments("curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com")); assertions += 1;
    assertFetchKeys(commandExecutableCurl, ["OPENAI_API_KEY"], "injects env for command hook curl arguments"); assertions += 1;

    const commandExecutableGit = runHookCase({
        kind: "command",
        input: { command: "git", arguments: "clone 'https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableGit.input as CommandCase["input"]).command, "git"); assertions += 1;
    assert.equal((commandExecutableGit.input as CommandCase["input"]).arguments, expectedWrappedArguments("git clone \"https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git\"")); assertions += 1;
    assertFetchKeys(commandExecutableGit, ["GITHUB_TOKEN"], "injects env for command hook git arguments"); assertions += 1;

    const commandExecutablePathGit = runHookCase({
        kind: "command",
        input: { command: "/usr/bin/git", arguments: "push https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git main", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutablePathGit.input as CommandCase["input"]).command, "/usr/bin/git"); assertions += 1;
    assert.equal((commandExecutablePathGit.input as CommandCase["input"]).arguments, "push https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git main"); assertions += 1;
    assertFetchKeys(commandExecutablePathGit, ["GITHUB_TOKEN"], "injects env for command hook path-qualified git arguments"); assertions += 1;

    const commandExecutableGitNoArgs = runHookCase({
        kind: "command",
        input: { command: "git", arguments: "status", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableGitNoArgs.input as CommandCase["input"]).arguments, "status"); assertions += 1;
    assertNoFetch(commandExecutableGitNoArgs, "does not resolve command hook git commands without placeholders"); assertions += 1;

    const commandGitLikeExecutableName = runHookCase({
        kind: "command",
        input: { command: "git-lfs", arguments: "fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandGitLikeExecutableName.input as CommandCase["input"]).arguments, "fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git"); assertions += 1;
    assertNoFetch(commandGitLikeExecutableName, "does not inject command hook git-like executable names"); assertions += 1;

    const commandGitInShellArguments = runHookCase({
        kind: "command",
        input: { command: "bash", arguments: "-lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\"", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandGitInShellArguments.input as CommandCase["input"]).arguments, "-lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\""); assertions += 1;
    assertNoFetch(commandGitInShellArguments, "does not inject command hook nested git inside bash arguments"); assertions += 1;

    const commandWithMixedArguments = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandWithMixedArguments.input as CommandCase["input"]).command, "curl"); assertions += 1;
    assert.equal((commandWithMixedArguments.input as CommandCase["input"]).arguments, expectedWrappedArguments("curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" --output {{SECRET:GITHUB_TOKEN}} https://example.com")); assertions += 1;
    assertFetchKeys(commandWithMixedArguments, ["OPENAI_API_KEY"], "injects env only for safe command-hook placeholders"); assertions += 1;

    const bashLcCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26d", args: { command: "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\"" } },
        output: { args: { command: "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\"" } },
    });
    assert.equal((bashLcCommand.output as ToolCase["output"]).args.command, "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\""); assertions += 1;
    assertNoFetch(bashLcCommand, "does not rewrite nested curl embedded in bash -lc"); assertions += 1;

    const toolMissingKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "23", args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
    });
    assert.equal((toolMissingKey.output as ToolCase["output"]).args.command, expectedWrappedCommand("curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_MISSING_KEY}\" https://example.com")); assertions += 1;
    assert.equal(toolMissingKey.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;

    const gitMissingKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "23g", args: { command: "git clone https://x-access-token:{{SECRET:MISSING_GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
        output: { args: { command: "git clone https://x-access-token:{{SECRET:MISSING_GITHUB_TOKEN}}@github.com/acme/private-repo.git" } },
    });
    assert.equal((gitMissingKey.output as ToolCase["output"]).args.command, expectedWrappedCommand("git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_MISSING_GITHUB_TOKEN}@github.com/acme/private-repo.git")); assertions += 1;
    assert.equal(gitMissingKey.error, "This command references missing secrets: MISSING_GITHUB_TOKEN. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;

    const failedThenUnrelatedSequence = runHookSequence([
        {
            kind: "tool",
            input: { tool: "bash", sessionID: "child-session", callID: "23a", args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
            output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
        },
        {
            kind: "tool",
            input: { tool: "bash", sessionID: "child-session", callID: "23b", args: { command: "echo hello-world" } },
            output: { args: { command: "echo hello-world" } },
        },
    ]);
    assert.equal(failedThenUnrelatedSequence.steps[0]?.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;
    assert.equal(failedThenUnrelatedSequence.steps[1]?.error, undefined); assertions += 1;
    assert.deepEqual(failedThenUnrelatedSequence.steps[1]?.shellEnv, {}); assertions += 1;
    assert.deepEqual(
        failedThenUnrelatedSequence.fetchCalls,
        [{ authorization: "Bearer root-session", keys: ["MISSING_KEY"] }],
        "does not carry failed secret resolution state into a later unrelated command in the same session",
    ); assertions += 1;

    const toolApiFailure = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "25", args: { command: "curl -H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com" } },
    });
    assert.equal(toolApiFailure.error, "Internal secret resolution failure"); assertions += 1;

    const rootSessionLookupFailure = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "bad-session", callID: "25a", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal(rootSessionLookupFailure.error, "Session lookup failed from API"); assertions += 1;
    assertNoFetch(rootSessionLookupFailure, "does not call secret resolution when root session lookup fails"); assertions += 1;

    const directSecretEnvReferenceTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26", args: { command: "echo $__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY" } },
        output: { args: { command: "echo $__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY" } },
    });
    assert.equal(directSecretEnvReferenceTool.error, "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceTool, "rejects direct shell-style secret env references before any resolution"); assertions += 1;

    const directSecretEnvReferenceBracedTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "27", args: { command: "echo ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}" } },
        output: { args: { command: "echo ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}" } },
    });
    assert.equal(directSecretEnvReferenceBracedTool.error, "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceBracedTool, "rejects direct braced secret env references before any resolution"); assertions += 1;

    const directSecretEnvReferenceCommandHook = runHookCase({
        kind: "command",
        input: { command: "echo $__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal(directSecretEnvReferenceCommandHook.error, "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceCommandHook, "rejects direct secret env references in command hook input"); assertions += 1;

    const printenvSecretEnvReferenceTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "28", args: { command: "printenv __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY" } },
        output: { args: { command: "printenv __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY" } },
    });
    assert.equal(printenvSecretEnvReferenceTool.error, "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(printenvSecretEnvReferenceTool, "rejects bare runtime secret env names before any resolution"); assertions += 1;

    const quotedSecretEnvReferenceTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "29", args: { command: "python -c 'print(\"__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY\")'" } },
        output: { args: { command: "python -c 'print(\"__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY\")'" } },
    });
    assert.equal(quotedSecretEnvReferenceTool.error, "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(quotedSecretEnvReferenceTool, "rejects quoted runtime secret env names before any resolution"); assertions += 1;

    const executedPrivateTokenCurl = runExecutedCurlCase(
        "curl -i -H \"PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}\" \"https://api.example.test/user\"",
    );
    assert.ok(!executedPrivateTokenCurl.rewrittenCommand.startsWith("bash -lc "), executedPrivateTokenCurl.rewrittenCommand); assertions += 1;
    assert.ok(executedPrivateTokenCurl.rewrittenCommand.includes("PRIVATE-TOKEN: ${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}"), executedPrivateTokenCurl.rewrittenCommand); assertions += 1;
    assert.equal(executedPrivateTokenCurl.status, 0); assertions += 1;
    assert.ok(executedPrivateTokenCurl.stdout.includes("200"), executedPrivateTokenCurl.stdout); assertions += 1;
    assert.equal(executedPrivateTokenCurl.receivedPrivateToken, "resolved-gitlab_token"); assertions += 1;

    console.log(`Secret proxy plugin tests passed: ${assertions}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

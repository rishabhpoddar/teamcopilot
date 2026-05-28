import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ShellCommandCase = {
    input: {
        command: string;
        args: string[];
        cwd: string;
        sessionID: string;
        callID?: string;
    };
    output: {
        command: string;
        args: string[];
        env: Record<string, string>;
    };
};

type FetchCall = {
    authorization: string;
    keys: string[];
};

type HookResult = {
    input: ShellCommandCase["input"];
    output: ShellCommandCase["output"];
    fetchCalls: FetchCall[];
    shellEnv: Record<string, string>;
    error?: string;
};

type SequenceStepResult = HookResult;

type SequenceResult = {
    steps: SequenceStepResult[];
    fetchCalls: FetchCall[];
};

function createPluginUrl(): string {
    return pathToFileURL(path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/secret-proxy.ts")).href;
}

function runShellCommandCase(shellCase: ShellCommandCase): HookResult {
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

const shellOutput = {
  command: payload.input.command,
  args: [...payload.input.args],
  env: {},
};

try {
  await hooks["shell.command.before"](
    {
      command: payload.input.command,
      args: payload.input.args,
      cwd: payload.input.cwd,
      sessionID: payload.input.sessionID,
      callID: payload.input.callID,
    },
    shellOutput,
  );
  console.log(JSON.stringify({
    input: payload.input,
    output: shellOutput,
    fetchCalls,
    shellEnv: shellOutput.env,
  }));
} catch (err) {
  console.log(JSON.stringify({
    input: payload.input,
    output: shellOutput,
    fetchCalls,
    shellEnv: shellOutput.env,
    error: err instanceof Error ? err.message : String(err),
  }));
}
`;

    const result = spawnSync(
        "node",
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                SECRET_PROXY_PLUGIN_PATH: createPluginUrl(),
                SECRET_PROXY_CASE_JSON: JSON.stringify(shellCase),
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

function runShellCommandSequence(shellCases: ShellCommandCase[]): SequenceResult {
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
  const shellOutput = {
    command: hookCase.input.command,
    args: [...hookCase.input.args],
    env: {},
  };
  try {
    await hooks["shell.command.before"](
      {
        command: hookCase.input.command,
        args: hookCase.input.args,
        cwd: hookCase.input.cwd,
        sessionID: hookCase.input.sessionID,
        callID: hookCase.input.callID,
      },
      shellOutput,
    );
    steps.push({
      input: hookCase.input,
      output: shellOutput,
      shellEnv: shellOutput.env,
    });
  } catch (err) {
    steps.push({
      input: hookCase.input,
      output: shellOutput,
      shellEnv: shellOutput.env,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

console.log(JSON.stringify({ steps, fetchCalls }));
`;

    const result = spawnSync(
        "node",
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                SECRET_PROXY_PLUGIN_PATH: createPluginUrl(),
                SECRET_PROXY_CASE_JSON: JSON.stringify(shellCases),
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

    return JSON.parse(jsonLine) as SequenceResult;
}

function assertNoFetch(result: HookResult, label: string): void {
    assert.deepEqual(result.fetchCalls, [], label);
}

function assertFetchKeys(
    result: HookResult,
    expectedKeys: string[],
    label: string,
    expectedAuthorization = "Bearer root-session",
): void {
    assert.deepEqual(result.fetchCalls, [{ authorization: expectedAuthorization, keys: expectedKeys }], label);
}

function assertRewritten(
    result: HookResult,
    expectedCommand: string,
    expectedArgs: string[],
    label: string,
): void {
    assert.equal(result.output.command, expectedCommand, label);
    assert.deepEqual(result.output.args, expectedArgs, label);
}

function shellCase(
    command: string,
    expectedCommand: string,
    keys: string[] = [],
    args: string[] = [],
    expectedArgs: string[] = args,
    sessionID = "child-session",
    callID?: string,
    expectedAuthorization = "Bearer root-session",
): ShellCommandCase & {
    expectedCommand: string;
    expectedArgs: string[];
    expectedKeys: string[];
    expectedAuthorization: string;
} {
    return {
        input: {
            command,
            args,
            cwd: process.cwd(),
            sessionID,
            callID,
        },
        output: {
            command: expectedCommand,
            args: expectedArgs,
            env: {},
        },
        expectedCommand,
        expectedArgs,
        expectedKeys: keys,
        expectedAuthorization,
    } as ShellCommandCase & {
        expectedCommand: string;
        expectedArgs: string[];
        expectedKeys: string[];
        expectedAuthorization: string;
    };
}

function unwrapShellCase(
    shellCommandCase: ShellCommandCase & {
        expectedCommand: string;
        expectedArgs: string[];
        expectedKeys: string[];
        expectedAuthorization: string;
    },
): ShellCommandCase {
    return {
        input: shellCommandCase.input,
        output: shellCommandCase.output,
    };
}

async function main(): Promise<void> {
    let assertions = 0;

    const curlCases = [
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com",
            "curl --header=Authorization:Bearer-${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN} https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com",
            "curl -d \"{\\\"token\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com",
            "curl -H \"Cookie: session=${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com",
            "curl -u user:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN} https://example.com",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com",
            "curl -F \"token=${__TEAMCOPILOT_RUNTIME_SECRET_SLACK_TOKEN}\" https://example.com",
            ["SLACK_TOKEN"],
        ),
        shellCase(
            "curl -H \"Authorization: Bearer {{SECRET:API_TOKEN}}\" https://example.com",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl 'https://api.example.com/{{SECRET:OPENAI_API_KEY}}?mode=full&debug=1'",
            "curl \"https://api.example.com/${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}?mode=full&debug=1\"",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -sS \\\n  -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' \\\n  \"https://example.com\"",
            "curl -sS \\\n  -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" \\\n  \"https://example.com\"",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl \\\n    -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' \\\n    https://example.com",
            "curl \\\n    -d \"{\\\"token\\\":\\\"${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" \\\n    https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -H 'X-Api-Key: a={{SECRET:OPENAI_API_KEY}};b={{SECRET:GITHUB_TOKEN}}' https://example.com",
            "curl -H \"X-Api-Key: a=${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY};b=${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" https://example.com",
            ["GITHUB_TOKEN", "OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -H 'X-Api-Key: prefix`{{SECRET:OPENAI_API_KEY}}`suffix' https://example.com",
            "curl -H \"X-Api-Key: prefix\\`${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\`suffix\" https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -H 'X-Api-Key: path\\\\{{SECRET:OPENAI_API_KEY}}' https://example.com",
            "curl -H \"X-Api-Key: path\\\\\\\\${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -d '{\"note\":\"say \\\"hi\\\" to {{SECRET:OPENAI_API_KEY}}\"}' https://example.com",
            "curl -d \"{\\\"note\\\":\\\"say \\\\\\\"hi\\\\\\\" to ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "echo before && curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com && echo after",
            "echo before && curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com && echo after",
            ["OPENAI_API_KEY"],
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:FIRST_TOKEN}}' https://first.example.com && curl -H 'X-Api-Key: {{SECRET:SECOND_TOKEN}}' https://second.example.com",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_FIRST_TOKEN}\" https://first.example.com && curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_SECOND_TOKEN}\" https://second.example.com",
            ["FIRST_TOKEN", "SECOND_TOKEN"],
        ),
        shellCase(
            "curl --oauth2-bearer {{SECRET:PRIMARY_TOKEN}} https://primary.example.com || curl --cookie 'sid={{SECRET:FALLBACK_COOKIE}}' https://fallback.example.com; curl --data-urlencode token={{SECRET:THIRD_TOKEN}} https://third.example.com",
            "curl --oauth2-bearer ${__TEAMCOPILOT_RUNTIME_SECRET_PRIMARY_TOKEN} https://primary.example.com || curl --cookie \"sid=${__TEAMCOPILOT_RUNTIME_SECRET_FALLBACK_COOKIE}\" https://fallback.example.com; curl --data-urlencode token=${__TEAMCOPILOT_RUNTIME_SECRET_THIRD_TOKEN} https://third.example.com",
            ["FALLBACK_COOKIE", "PRIMARY_TOKEN", "THIRD_TOKEN"],
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:FIRST_TOKEN}}' https://first.example.com | curl -H 'X-Api-Key: {{SECRET:SECOND_TOKEN}}' https://second.example.com",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_FIRST_TOKEN}\" https://first.example.com | curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_SECOND_TOKEN}\" https://second.example.com",
            ["FIRST_TOKEN", "SECOND_TOKEN"],
        ),
        shellCase(
            "echo {{SECRET:SHOULD_NOT_RESOLVE}} && curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com",
            "echo {{SECRET:SHOULD_NOT_RESOLVE}} && curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com && echo {{SECRET:SHOULD_NOT_RESOLVE}}",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com && echo {{SECRET:SHOULD_NOT_RESOLVE}}",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:FIRST_TOKEN}}' 'https://example.com/path?next=a&&b=c;pipe=x|y' && curl --data 'token={{SECRET:SECOND_TOKEN}}&literal=a&&b' https://example.com/post",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_FIRST_TOKEN}\" 'https://example.com/path?next=a&&b=c;pipe=x|y' && curl --data \"token=${__TEAMCOPILOT_RUNTIME_SECRET_SECOND_TOKEN}&literal=a&&b\" https://example.com/post",
            ["FIRST_TOKEN", "SECOND_TOKEN"],
        ),
        shellCase(
            "echo $(curl -H 'Authorization: Bearer {{SECRET:SHOULD_NOT_RESOLVE}}' https://nested.example.com) && curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://top.example.com",
            "echo $(curl -H 'Authorization: Bearer {{SECRET:SHOULD_NOT_RESOLVE}}' https://nested.example.com) && curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://top.example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "TOKEN={{SECRET:SHOULD_NOT_RESOLVE}} curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com",
            "TOKEN={{SECRET:SHOULD_NOT_RESOLVE}} curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com",
            [],
        ),
        shellCase(
            "( curl -H 'Authorization: Bearer {{SECRET:SHOULD_NOT_RESOLVE}}' https://nested.example.com ) && curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://top.example.com",
            "( curl -H 'Authorization: Bearer {{SECRET:SHOULD_NOT_RESOLVE}}' https://nested.example.com ) && curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://top.example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl https://example.com > {{SECRET:SHOULD_NOT_RESOLVE}}",
            "curl https://example.com > {{SECRET:SHOULD_NOT_RESOLVE}}",
            [],
        ),
        shellCase(
            "curl https://example.com >> {{SECRET:SHOULD_NOT_RESOLVE}} && curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://api.example.com",
            "curl https://example.com >> {{SECRET:SHOULD_NOT_RESOLVE}} && curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://api.example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl https://example.com 2> {{SECRET:SHOULD_NOT_RESOLVE}}",
            "curl https://example.com 2> {{SECRET:SHOULD_NOT_RESOLVE}}",
            [],
        ),
        shellCase(
            "curl https://example.com>{{SECRET:SHOULD_NOT_RESOLVE}}",
            "curl https://example.com>{{SECRET:SHOULD_NOT_RESOLVE}}",
            [],
        ),
        shellCase(
            "curl --data @- https://example.com < {{SECRET:SHOULD_NOT_RESOLVE}}",
            "curl --data @- https://example.com < {{SECRET:SHOULD_NOT_RESOLVE}}",
            [],
        ),
        shellCase(
            "curl > {{SECRET:SHOULD_NOT_RESOLVE}} -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com",
            "curl > {{SECRET:SHOULD_NOT_RESOLVE}} -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "curl 2>&1 -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com",
            "curl 2>&1 -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.com",
            ["API_TOKEN"],
        ),
        shellCase(
            "POLICY_JSON='{\"policies\":[{\"id\":\"alpha-1\",\"policy_text\":\"first policy text\"},{\"id\":\"beta-2\",\"policy_text\":\"second policy text\"}]}'\ncurl -sS -X POST \"https://example.test/policies/update\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer {{SECRET:POLICY_API_KEY}}\" \\\n  -d \"$POLICY_JSON\"",
            "POLICY_JSON='{\"policies\":[{\"id\":\"alpha-1\",\"policy_text\":\"first policy text\"},{\"id\":\"beta-2\",\"policy_text\":\"second policy text\"}]}'\ncurl -sS -X POST \"https://example.test/policies/update\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" \\\n  -d \"$POLICY_JSON\"",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-a",
            "newline-assignment-tool",
            "Bearer session-a",
        ),
        shellCase(
            "echo ready &&\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "echo ready &&\n  curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" https://example.test/policies/update",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-c",
            "newline-and-tool",
            "Bearer session-c",
        ),
        shellCase(
            "echo first ||\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "echo first ||\n  curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" https://example.test/policies/update",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-d",
            "newline-or-tool",
            "Bearer session-d",
        ),
        shellCase(
            "echo first;\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "echo first;\n  curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" https://example.test/policies/update",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-e",
            "newline-semicolon-tool",
            "Bearer session-e",
        ),
        shellCase(
            "echo first |\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "echo first |\n  curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" https://example.test/policies/update",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-f",
            "newline-pipe-tool",
            "Bearer session-f",
        ),
        shellCase(
            "# prepare request\ncurl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "# prepare request\ncurl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_POLICY_API_KEY}\" https://example.test/policies/update",
            ["POLICY_API_KEY"],
            [],
            [],
            "session-g",
            "comment-line-tool",
            "Bearer session-g",
        ),
        shellCase(
            "POLICY_JSON='{\"id\":\"alpha-1\"}' \\\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            "POLICY_JSON='{\"id\":\"alpha-1\"}' \\\n  curl -H 'Authorization: Bearer {{SECRET:POLICY_API_KEY}}' https://example.test/policies/update",
            [],
            [],
            [],
            "session-h",
            "escaped-newline-tool",
            "Bearer session-h",
        ),
        shellCase(
            "echo prepare\n\ngit clone https://token:{{SECRET:GITHUB_TOKEN}}@example.test/repo.git",
            "echo prepare\n\ngit clone https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@example.test/repo.git",
            ["GITHUB_TOKEN"],
            [],
            [],
            "session-i",
            "blank-line-git-tool",
            "Bearer session-i",
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.test/api\n\ngit push https://token:{{SECRET:GITHUB_TOKEN}}@example.test/repo.git main",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.test/api\n\ngit push https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@example.test/repo.git main",
            ["API_TOKEN", "GITHUB_TOKEN"],
            [],
            [],
            "session-j",
            "curl-blank-git-tool",
            "Bearer session-j",
        ),
        shellCase(
            "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.test/api\n git clone https://token:{{SECRET:GITHUB_TOKEN}}@example.test/repo.git",
            "curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_API_TOKEN}\" https://example.test/api\n git clone https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@example.test/repo.git",
            ["API_TOKEN", "GITHUB_TOKEN"],
            [],
            [],
            "session-k",
            "newline-curl-git-tool",
            "Bearer session-k",
        ),
    ];

    for (const testCase of curlCases) {
        const result = runShellCommandCase(unwrapShellCase(testCase));
        assertRewritten(result, testCase.expectedCommand, testCase.expectedArgs, testCase.expectedCommand);
        if (testCase.expectedKeys.length > 0) {
            assertFetchKeys(result, testCase.expectedKeys, testCase.expectedCommand, testCase.expectedAuthorization);
        } else {
            assertNoFetch(result, testCase.expectedCommand);
        }
        assertions += 3;
    }

    const gitCases = [
        shellCase(
            "git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push origin main",
            "git -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" push origin main",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "git clone 'https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/private-repo.git'",
            "git clone \"https://oauth2:${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}@gitlab.com/acme/private-repo.git\"",
            ["GITLAB_TOKEN"],
        ),
        shellCase(
            "git remote set-url origin https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "git remote set-url origin https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "git -c http.https://github.com/.extraheader='AUTHORIZATION: basic {{SECRET:GITHUB_TOKEN}}' fetch origin main",
            "git -c \"http.https://github.com/.extraheader=AUTHORIZATION: basic ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" fetch origin main",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "git -c user.email='bot+{{SECRET:GITHUB_TOKEN}}@example.com' commit -m 'sync private repo'",
            "git -c \"user.email=bot+${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@example.com\" commit -m 'sync private repo'",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "git -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' push https://oauth2:{{SECRET:GITLAB_TOKEN}}@gitlab.com/acme/repo.git main",
            "git -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" push https://oauth2:${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}@gitlab.com/acme/repo.git main",
            ["GITHUB_TOKEN", "GITLAB_TOKEN"],
        ),
        shellCase(
            "/usr/bin/git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "/usr/bin/git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git",
            ["GITHUB_TOKEN"],
            [],
            [],
            "grandchild-session",
            "git-path-executable",
            "Bearer root-session",
        ),
        shellCase(
            "echo before && git push https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git main && echo after",
            "echo before && git push https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git main && echo after",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com && git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git",
            ["GITHUB_TOKEN", "OPENAI_API_KEY"],
        ),
        shellCase(
            "git \\\n  -c 'http.extraHeader=Authorization: Bearer {{SECRET:GITHUB_TOKEN}}' \\\n  fetch origin main",
            "git \\\n  -c \"http.extraHeader=Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}\" \\\n  fetch origin main",
            ["GITHUB_TOKEN"],
        ),
        shellCase(
            "echo ok",
            "echo ok",
            [],
            [],
            [],
            "child-session",
            "quoted-git-string",
            "Bearer root-session",
        ),
        shellCase(
            "git-lfs fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "git-lfs fetch https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            [],
        ),
        shellCase(
            "GIT clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "GIT clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            [],
        ),
        shellCase(
            "git-{{SECRET:GITHUB_TOKEN}} status",
            "git-{{SECRET:GITHUB_TOKEN}} status",
            [],
        ),
        shellCase(
            "git status > {{SECRET:SHOULD_NOT_RESOLVE}}",
            "git status > {{SECRET:SHOULD_NOT_RESOLVE}}",
            [],
        ),
        shellCase(
            "echo cloning git-private-repo-{{SECRET:GITHUB_TOKEN}}",
            "echo cloning git-private-repo-{{SECRET:GITHUB_TOKEN}}",
            [],
        ),
        shellCase(
            "echo 'git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'",
            "echo 'git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'",
            [],
        ),
        shellCase(
            "bash -lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\"",
            "bash -lc \"git clone https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git\"",
            [],
        ),
    ];

    for (const testCase of gitCases) {
        const result = runShellCommandCase(unwrapShellCase(testCase));
        assertRewritten(result, testCase.expectedCommand, testCase.expectedArgs, testCase.expectedCommand);
        if (testCase.expectedKeys.length > 0) {
            assertFetchKeys(result, testCase.expectedKeys, testCase.expectedCommand, testCase.expectedAuthorization);
        } else {
            assertNoFetch(result, testCase.expectedCommand);
        }
        assertions += 3;
    }

    const commandArgsCases = [
        shellCase(
            "bash",
            "bash",
            ["OPENAI_API_KEY"],
            ["curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com"],
            ["curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com"],
        ),
        shellCase(
            "bash",
            "bash",
            ["GITHUB_TOKEN"],
            ["git clone 'https://x-access-token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git'"],
            ["git clone \"https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git\""],
        ),
        shellCase(
            "bash",
            "bash",
            ["GITHUB_TOKEN"],
            ["/usr/bin/git push https://token:{{SECRET:GITHUB_TOKEN}}@github.com/acme/private-repo.git main"],
            ["/usr/bin/git push https://token:${__TEAMCOPILOT_RUNTIME_SECRET_GITHUB_TOKEN}@github.com/acme/private-repo.git main"],
        ),
        shellCase(
            "bash",
            "bash",
            ["OPENAI_API_KEY"],
            ["curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com"],
            ["curl -H \"Authorization: Bearer ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" --output {{SECRET:GITHUB_TOKEN}} https://example.com"],
        ),
    ];

    for (const testCase of commandArgsCases) {
        const result = runShellCommandCase(unwrapShellCase(testCase));
        assertRewritten(result, testCase.expectedCommand, testCase.expectedArgs, testCase.expectedCommand);
        assertFetchKeys(result, testCase.expectedKeys, testCase.expectedCommand);
        assertions += 3;
    }

    const directSecretEnvReferenceCases = [
        shellCase(
            "echo $__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY",
            "echo $__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY",
            [],
        ),
        shellCase(
            "echo ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}",
            "echo ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}",
            [],
        ),
        shellCase(
            "printenv __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY",
            "printenv __TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY",
            [],
        ),
        shellCase(
            "python -c 'print(\"__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY\")'",
            "python -c 'print(\"__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY\")'",
            [],
        ),
    ];

    for (const testCase of directSecretEnvReferenceCases) {
        const result = runShellCommandCase(unwrapShellCase(testCase));
        assert.equal(
            result.error,
            "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead.",
            testCase.expectedCommand,
        );
        assertNoFetch(result, testCase.expectedCommand);
        assertions += 2;
    }

    const missingSecretCases = [
        shellCase(
            "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com",
            "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_MISSING_KEY}\" https://example.com",
            ["MISSING_KEY"],
        ),
        shellCase(
            "git clone https://x-access-token:{{SECRET:MISSING_GITHUB_TOKEN}}@github.com/acme/private-repo.git",
            "git clone https://x-access-token:${__TEAMCOPILOT_RUNTIME_SECRET_MISSING_GITHUB_TOKEN}@github.com/acme/private-repo.git",
            ["MISSING_GITHUB_TOKEN"],
        ),
    ];

    for (const testCase of missingSecretCases) {
        const result = runShellCommandCase(unwrapShellCase(testCase));
        assert.equal(
            result.error,
            `This command references missing secrets: ${testCase.expectedKeys.join(", ")}. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.`,
            testCase.expectedCommand,
        );
        assertFetchKeys(result, testCase.expectedKeys, testCase.expectedCommand);
        assertions += 2;
    }

    const apiFailure = runShellCommandCase(
        shellCase(
            "curl -H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com",
            "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_API_FAIL}\" https://example.com",
            ["API_FAIL"],
        ),
    );
    assert.equal(apiFailure.error, "Internal secret resolution failure");
    assertFetchKeys(apiFailure, ["API_FAIL"], "propagates API failure after attempting secret resolution");
    assertions += 2;

    const rootSessionLookupFailure = runShellCommandCase(
        shellCase(
            "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com",
            "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_OPENAI_API_KEY}\" https://example.com",
            ["OPENAI_API_KEY"],
            [],
            [],
            "bad-session",
            "lookup-fail",
        ),
    );
    assert.equal(rootSessionLookupFailure.error, "Session lookup failed from API");
    assertNoFetch(rootSessionLookupFailure, "does not call secret resolution when root session lookup fails");
    assertions += 2;

    const failedThenUnrelatedSequence = runShellCommandSequence([
        {
            input: {
                command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com",
                args: [],
                cwd: process.cwd(),
                sessionID: "child-session",
                callID: "seq-1",
            },
            output: {
                command: "curl -H \"X-Api-Key: ${__TEAMCOPILOT_RUNTIME_SECRET_MISSING_KEY}\" https://example.com",
                args: [],
                env: {},
            },
        },
        {
            input: {
                command: "echo hello-world",
                args: [],
                cwd: process.cwd(),
                sessionID: "child-session",
                callID: "seq-2",
            },
            output: {
                command: "echo hello-world",
                args: [],
                env: {},
            },
        },
    ]);
    assert.equal(
        failedThenUnrelatedSequence.steps[0]?.error,
        "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
    );
    assert.equal(failedThenUnrelatedSequence.steps[1]?.error, undefined);
    assert.deepEqual(failedThenUnrelatedSequence.steps[1]?.shellEnv, {});
    assert.deepEqual(
        failedThenUnrelatedSequence.fetchCalls,
        [{ authorization: "Bearer root-session", keys: ["MISSING_KEY"] }],
        "does not carry failed secret resolution state into a later unrelated command in the same session",
    );
    assertions += 4;

    const executedPrivateTokenCurl = runExecutedCurlCase(
        "curl -i -H \"PRIVATE-TOKEN: {{SECRET:GITLAB_TOKEN}}\" \"https://api.example.test/user\"",
    );
    assert.ok(!executedPrivateTokenCurl.rewrittenCommand.startsWith("bash -lc "), executedPrivateTokenCurl.rewrittenCommand);
    assert.ok(
        executedPrivateTokenCurl.rewrittenCommand.includes("PRIVATE-TOKEN: ${__TEAMCOPILOT_RUNTIME_SECRET_GITLAB_TOKEN}"),
        executedPrivateTokenCurl.rewrittenCommand,
    );
    assert.equal(executedPrivateTokenCurl.status, 0);
    assert.ok(executedPrivateTokenCurl.stdout.includes("200"), executedPrivateTokenCurl.stdout);
    assert.equal(executedPrivateTokenCurl.receivedPrivateToken, "resolved-gitlab_token");
    assertions += 5;

    console.log(`Secret proxy plugin tests passed: ${assertions}`);
}

function runExecutedCurlCase(command: string): {
    rewrittenCommand: string;
    shellEnv: Record<string, string>;
    stdout: string;
    stderr: string;
    status: number | null;
    receivedPrivateToken: string | null;
} {
    const script = `
import http from "node:http";
import { spawn } from "node:child_process";

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

const shellCommand = {
  command: command.replace("https://api.example.test/user", url),
  args: [],
  cwd: process.cwd(),
  sessionID: "child-session",
  callID: "exec-1",
};
const shellOutput = { command: shellCommand.command, args: shellCommand.args, env: {} };

await hooks["shell.command.before"](shellCommand, shellOutput);

const executionResult = await new Promise((resolve, reject) => {
  const child = spawn("bash", ["-lc", shellOutput.command], {
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
  rewrittenCommand: shellOutput.command,
  shellEnv: shellOutput.env,
  stdout: executionResult.stdout,
  stderr: executionResult.stderr,
  status: executionResult.status,
  receivedPrivateToken: serverState.privateToken,
}));
`;

    const result = spawnSync(
        "node",
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TEAMCOPILOT_PORT: "5124",
                SECRET_PROXY_PLUGIN_PATH: createPluginUrl(),
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

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

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
    text: string;
};

type HookResult = {
    input: HookCase["input"];
    output: HookCase["output"];
    fetchCalls: FetchCall[];
    error?: string;
};

function runHookCase(pluginCase: HookCase): HookResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/secret-proxy.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.SECRET_PROXY_PLUGIN_PATH;
const payload = JSON.parse(process.env.SECRET_PROXY_CASE_JSON || "{}");
const mod = await import(pluginPath);
const fetchCalls = [];

function extractKeys(text) {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\\{\\{SECRET:([A-Za-z_][A-Za-z0-9_]*)\\}\\}/g), (match) => String(match[1] || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function substitute(text) {
  return text.replace(/\\{\\{SECRET:([A-Za-z_][A-Za-z0-9_]*)\\}\\}/g, (_match, key) => {
    return "resolved-" + String(key).trim().toUpperCase().toLowerCase();
  });
}

globalThis.fetch = async (_url, options = {}) => {
  const headers = options.headers ?? {};
  const authorization = typeof headers.Authorization === "string"
    ? headers.Authorization
    : typeof headers.authorization === "string"
      ? headers.authorization
      : "";
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const text = typeof body.text === "string" ? body.text : "";
  fetchCalls.push({ authorization, text });

  const keys = extractKeys(text);
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

  return {
    ok: true,
    json: async () => ({ substituted_text: substitute(text) }),
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
        if (path.id === "grandchild-session") {
          return { data: { id: "grandchild-session", parentID: "child-session" } };
        }
        return { data: { id: path.id, parentID: null } };
      },
    },
  },
});

try {
  if (payload.kind === "tool") {
    await hooks["tool.execute.before"](payload.input, payload.output);
  } else {
    await hooks["command.execute.before"](payload.input, payload.output);
  }
  console.log(JSON.stringify({ input: payload.input, output: payload.output, fetchCalls }));
} catch (err) {
  console.log(JSON.stringify({
    input: payload.input,
    output: payload.output,
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

function assertFetchCalls(result: HookResult, expectedTexts: string[], label: string): void {
    assert.deepEqual(
        result.fetchCalls,
        expectedTexts.map((text) => ({ authorization: "Bearer root-session", text })),
        label,
    );
}

function assertNoFetch(result: HookResult, label: string): void {
    assert.deepEqual(result.fetchCalls, [], label);
}

function assertNoError(result: HookResult, label: string): void {
    assert.equal(result.error, undefined, label);
}

function assertError(result: HookResult, expectedMessage: string, label: string): void {
    assert.equal(result.error, expectedMessage, label);
}

function main(): void {
    let assertions = 0;

    const toolCommand = runHookCase({
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
    assertNoError(toolCommand, "tool command rewrite should succeed"); assertions += 1;
    assert.equal((toolCommand.output as ToolCase["output"]).args.command, "echo resolved-openai_api_key", "rewrites output.args.command"); assertions += 1;
    assert.equal((toolCommand.input as ToolCase["input"]).args?.command, "echo resolved-openai_api_key", "rewrites input.args.command"); assertions += 1;
    assertFetchCalls(toolCommand, ["echo {{SECRET:OPENAI_API_KEY}}"], "deduplicates identical command strings across input/output"); assertions += 1;

    const toolCmd = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c2", args: { cmd: "printf {{SECRET:API_TOKEN}}" } },
        output: { args: { cmd: "printf {{SECRET:API_TOKEN}}" } },
    });
    assertNoError(toolCmd, "tool cmd rewrite should succeed"); assertions += 1;
    assert.equal((toolCmd.output as ToolCase["output"]).args.cmd, "printf resolved-api_token", "rewrites output.args.cmd"); assertions += 1;

    const nestedObject = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c3", args: { command: "echo ok" } },
        output: {
            args: {
                metadata: {
                    nested: "Bearer {{SECRET:OPENAI_API_KEY}}",
                    untouched: "hello",
                },
            },
        },
    });
    assertNoError(nestedObject, "nested object rewrite should succeed"); assertions += 1;
    assert.equal(((nestedObject.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "Bearer resolved-openai_api_key", "rewrites nested object field"); assertions += 1;
    assert.equal(((nestedObject.output as ToolCase["output"]).args.metadata as { untouched: string }).untouched, "hello", "preserves untouched nested object field"); assertions += 1;

    const nestedArray = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c4", args: { command: "echo ok" } },
        output: {
            args: {
                parts: [
                    "pre",
                    "token={{SECRET:GITHUB_TOKEN}}",
                    { deep: "Bearer {{SECRET:SLACK_TOKEN}}" },
                    ["{{SECRET:OPENAI_API_KEY}}", "literal"],
                ],
            },
        },
    });
    assertNoError(nestedArray, "nested array rewrite should succeed"); assertions += 1;
    const nestedArrayParts = (nestedArray.output as ToolCase["output"]).args.parts as unknown[];
    assert.equal(nestedArrayParts[0], "pre", "preserves leading plain array string"); assertions += 1;
    assert.equal(nestedArrayParts[1], "token=resolved-github_token", "rewrites direct array string"); assertions += 1;
    assert.equal((nestedArrayParts[2] as { deep: string }).deep, "Bearer resolved-slack_token", "rewrites object inside array"); assertions += 1;
    assert.equal((nestedArrayParts[3] as string[])[0], "resolved-openai_api_key", "rewrites nested array string"); assertions += 1;
    assert.equal((nestedArrayParts[3] as string[])[1], "literal", "preserves nested array plain string"); assertions += 1;

    const duplicateNestedStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c5", args: { command: "echo ok" } },
        output: {
            args: {
                one: "{{SECRET:OPENAI_API_KEY}}",
                two: "{{SECRET:OPENAI_API_KEY}}",
                arr: ["{{SECRET:OPENAI_API_KEY}}", "{{SECRET:OPENAI_API_KEY}}"],
            },
        },
    });
    assertNoError(duplicateNestedStrings, "duplicate nested strings should succeed"); assertions += 1;
    assertFetchCalls(duplicateNestedStrings, ["{{SECRET:OPENAI_API_KEY}}"], "deduplicates repeated identical string values within one hook call"); assertions += 1;

    const multipleDistinctStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c6", args: { command: "echo ok" } },
        output: {
            args: {
                a: "echo {{SECRET:OPENAI_API_KEY}}",
                b: "curl {{SECRET:GITHUB_TOKEN}}",
                c: "Authorization: {{SECRET:SLACK_TOKEN}}",
            },
        },
    });
    assertNoError(multipleDistinctStrings, "multiple distinct strings should succeed"); assertions += 1;
    assertFetchCalls(
        multipleDistinctStrings,
        ["echo {{SECRET:OPENAI_API_KEY}}", "curl {{SECRET:GITHUB_TOKEN}}", "Authorization: {{SECRET:SLACK_TOKEN}}"],
        "resolves each distinct placeholder-containing string once",
    ); assertions += 1;

    const nonBashTool = runHookCase({
        kind: "tool",
        input: { tool: "task", sessionID: "child-session", callID: "c7", args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
    });
    assertNoError(nonBashTool, "non-bash tools should not error"); assertions += 1;
    assert.equal((nonBashTool.output as ToolCase["output"]).args.command, "echo {{SECRET:OPENAI_API_KEY}}", "does not rewrite non-bash tool output"); assertions += 1;
    assertNoFetch(nonBashTool, "does not call resolver for non-bash tools"); assertions += 1;

    const missingSessionTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "", callID: "c8", args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
    });
    assertNoError(missingSessionTool, "missing session tool should not error"); assertions += 1;
    assert.equal((missingSessionTool.output as ToolCase["output"]).args.command, "echo {{SECRET:OPENAI_API_KEY}}", "does not rewrite without session id"); assertions += 1;
    assertNoFetch(missingSessionTool, "does not call resolver without session id for tool hook"); assertions += 1;

    const missingSessionCommand = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:OPENAI_API_KEY}}", arguments: "", sessionID: "" },
        output: { parts: [] },
    });
    assertNoError(missingSessionCommand, "missing session command should not error"); assertions += 1;
    assert.equal((missingSessionCommand.input as CommandCase["input"]).command, "echo {{SECRET:OPENAI_API_KEY}}", "does not rewrite command.execute.before without session id"); assertions += 1;
    assertNoFetch(missingSessionCommand, "does not call resolver without session id for command hook"); assertions += 1;

    const noArgsTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c9" },
        output: { args: {} },
    });
    assertNoError(noArgsTool, "empty tool args should not error"); assertions += 1;
    assertNoFetch(noArgsTool, "does nothing when tool args contain no strings"); assertions += 1;

    const numericBooleanFields = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c10", args: { command: "echo ok", retries: 2, dryRun: true } as Record<string, unknown> },
        output: { args: { command: "echo ok", retries: 3, dryRun: false, nested: { count: 1, flag: true } } },
    });
    assertNoError(numericBooleanFields, "non-string fields should not error"); assertions += 1;
    assert.deepEqual((numericBooleanFields.output as ToolCase["output"]).args, { command: "echo ok", retries: 3, dryRun: false, nested: { count: 1, flag: true } }, "preserves non-string fields exactly"); assertions += 1;
    assertNoFetch(numericBooleanFields, "does not call resolver for non-string-only payloads"); assertions += 1;

    const nullUndefinedLikeStructures = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c11", args: { command: "echo ok", maybe: null } as Record<string, unknown> },
        output: { args: { command: "echo ok", maybe: null, list: [null, 123, false] } },
    });
    assertNoError(nullUndefinedLikeStructures, "null structures should not error"); assertions += 1;
    assertNoFetch(nullUndefinedLikeStructures, "does not resolve null/primitive structures"); assertions += 1;

    const lowerCaseKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c12", args: { command: "echo {{SECRET:openai_api_key}}" } },
        output: { args: { command: "echo {{SECRET:openai_api_key}}" } },
    });
    assertNoError(lowerCaseKey, "lowercase placeholders should succeed"); assertions += 1;
    assert.equal((lowerCaseKey.output as ToolCase["output"]).args.command, "echo resolved-openai_api_key", "rewrites lowercase placeholder keys"); assertions += 1;

    const multiplePlaceholdersSingleString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c13", args: { command: "curl -H 'A: {{SECRET:OPENAI_API_KEY}}' -H 'B: {{SECRET:GITHUB_TOKEN}}'" } },
        output: { args: { command: "curl -H 'A: {{SECRET:OPENAI_API_KEY}}' -H 'B: {{SECRET:GITHUB_TOKEN}}'" } },
    });
    assertNoError(multiplePlaceholdersSingleString, "multiple placeholders in one string should succeed"); assertions += 1;
    assert.equal(
        (multiplePlaceholdersSingleString.output as ToolCase["output"]).args.command,
        "curl -H 'A: resolved-openai_api_key' -H 'B: resolved-github_token'",
        "rewrites multiple placeholders in a single string",
    ); assertions += 1;

    const missingSingleKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c14", args: { command: "echo {{SECRET:MISSING_KEY}}" } },
        output: { args: { command: "echo {{SECRET:MISSING_KEY}}" } },
    });
    assertError(
        missingSingleKey,
        "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
        "returns exact single missing key",
    ); assertions += 1;

    const missingMultipleKeys = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c15",
            args: { command: "echo {{SECRET:MISSING_KEY}} {{SECRET:MISSING_ANOTHER_KEY}}" },
        },
        output: {
            args: { command: "echo {{SECRET:MISSING_KEY}} {{SECRET:MISSING_ANOTHER_KEY}}" },
        },
    });
    assertError(
        missingMultipleKeys,
        "This command references missing secrets: MISSING_KEY, MISSING_ANOTHER_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
        "returns exact multiple missing keys",
    ); assertions += 1;

    const apiFailure = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c16", args: { command: "echo {{SECRET:API_FAIL}}" } },
        output: { args: { command: "echo {{SECRET:API_FAIL}}" } },
    });
    assertError(apiFailure, "Internal secret resolution failure", "surfaces upstream API failure text"); assertions += 1;

    const commandHookCommandOnly = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:OPENAI_API_KEY}}", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertNoError(commandHookCommandOnly, "command hook command-only should succeed"); assertions += 1;
    assert.equal((commandHookCommandOnly.input as CommandCase["input"]).command, "echo resolved-openai_api_key", "rewrites command.execute.before command"); assertions += 1;
    assert.equal((commandHookCommandOnly.input as CommandCase["input"]).arguments, "", "preserves empty command arguments"); assertions += 1;

    const commandHookArgumentsOnly = runHookCase({
        kind: "command",
        input: { command: "node script.js", arguments: "--token={{SECRET:GITHUB_TOKEN}}", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertNoError(commandHookArgumentsOnly, "command hook arguments-only should succeed"); assertions += 1;
    assert.equal((commandHookArgumentsOnly.input as CommandCase["input"]).command, "node script.js", "preserves plain command"); assertions += 1;
    assert.equal((commandHookArgumentsOnly.input as CommandCase["input"]).arguments, "--token=resolved-github_token", "rewrites command arguments"); assertions += 1;

    const commandHookBothFields = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:OPENAI_API_KEY}}", arguments: "--header={{SECRET:GITHUB_TOKEN}}", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertNoError(commandHookBothFields, "command hook both fields should succeed"); assertions += 1;
    assert.equal((commandHookBothFields.input as CommandCase["input"]).command, "echo resolved-openai_api_key", "rewrites command hook command with placeholder"); assertions += 1;
    assert.equal((commandHookBothFields.input as CommandCase["input"]).arguments, "--header=resolved-github_token", "rewrites command hook arguments with placeholder"); assertions += 1;

    const commandHookNoPlaceholders = runHookCase({
        kind: "command",
        input: { command: "echo hello", arguments: "--verbose", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertNoError(commandHookNoPlaceholders, "plain command hook should succeed"); assertions += 1;
    assertNoFetch(commandHookNoPlaceholders, "plain command hook should not resolve"); assertions += 1;

    const commandHookMissingKey = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:MISSING_KEY}}", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertError(
        commandHookMissingKey,
        "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
        "command hook returns exact missing key",
    ); assertions += 1;

    const commandHookApiFailure = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:API_FAIL}}", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertError(commandHookApiFailure, "Internal secret resolution failure", "command hook surfaces API failure"); assertions += 1;

    const deepSessionResolution = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "grandchild-session", callID: "c17", args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
    });
    assertNoError(deepSessionResolution, "deep session resolution should succeed"); assertions += 1;
    assert.deepEqual(
        deepSessionResolution.fetchCalls,
        [{ authorization: "Bearer root-session", text: "echo {{SECRET:OPENAI_API_KEY}}" }],
        "resolves through multiple parent sessions to root session token",
    ); assertions += 1;

    const preservesShape = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c18",
            args: {
                command: "echo ok",
                nested: { a: "{{SECRET:OPENAI_API_KEY}}", b: 1 },
                arr: ["{{SECRET:GITHUB_TOKEN}}", { x: "{{SECRET:SLACK_TOKEN}}" }],
            },
        },
        output: {
            args: {
                command: "echo ok",
                nested: { a: "{{SECRET:OPENAI_API_KEY}}", b: 1 },
                arr: ["{{SECRET:GITHUB_TOKEN}}", { x: "{{SECRET:SLACK_TOKEN}}" }],
            },
        },
    });
    assertNoError(preservesShape, "shape preservation case should succeed"); assertions += 1;
    assert.deepEqual(
        Object.keys((preservesShape.output as ToolCase["output"]).args).sort(),
        ["arr", "command", "nested"],
        "preserves top-level output arg keys",
    ); assertions += 1;
    assert.deepEqual(
        Object.keys(((preservesShape.output as ToolCase["output"]).args.nested as Record<string, unknown>)).sort(),
        ["a", "b"],
        "preserves nested object keys",
    ); assertions += 1;

    const plainStringsMixedWithSecretStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c19", args: { command: "echo ok", note: "hello" } as Record<string, unknown> },
        output: {
            args: {
                command: "echo ok",
                note: "hello",
                env: ["A=1", "B={{SECRET:OPENAI_API_KEY}}", "C=3"],
            },
        },
    });
    assertNoError(plainStringsMixedWithSecretStrings, "mixed plain and secret strings should succeed"); assertions += 1;
    assert.deepEqual(
        (plainStringsMixedWithSecretStrings.output as ToolCase["output"]).args.env,
        ["A=1", "B=resolved-openai_api_key", "C=3"],
        "rewrites only the secret-bearing strings in arrays",
    ); assertions += 1;

    const noStructureChangeWhenNothingFound = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c20", args: { cwd: "/tmp", script: "echo hi" } as Record<string, unknown> },
        output: { args: { cwd: "/tmp", script: "echo hi" } },
    });
    assertNoError(noStructureChangeWhenNothingFound, "no placeholder structures should not error"); assertions += 1;
    assert.deepEqual((noStructureChangeWhenNothingFound.output as ToolCase["output"]).args, { cwd: "/tmp", script: "echo hi" }, "preserves exact args when nothing is rewritten"); assertions += 1;

    const nestedMissingKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c21", args: { command: "echo ok" } },
        output: { args: { nested: { auth: "Bearer {{SECRET:MISSING_KEY}}" } } },
    });
    assertError(
        nestedMissingKey,
        "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying.",
        "nested missing keys still fail with exact key",
    ); assertions += 1;

    const nestedApiFailure = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c22", args: { command: "echo ok" } },
        output: { args: { nested: { auth: "Bearer {{SECRET:API_FAIL}}" } } },
    });
    assertError(nestedApiFailure, "Internal secret resolution failure", "nested API failure surfaces error"); assertions += 1;

    const plainStringRoot = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c23", args: { command: "literal" } },
        output: { args: { command: "literal", note: "still literal" } },
    });
    assertNoError(plainStringRoot, "plain root strings should not error"); assertions += 1;
    assertNoFetch(plainStringRoot, "plain root strings should not call resolver"); assertions += 1;

    const arrayOnlyArgs = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c24", args: { command: "echo ok" } },
        output: { args: { list: ["{{SECRET:OPENAI_API_KEY}}", "{{SECRET:GITHUB_TOKEN}}", "x"] } },
    });
    assertNoError(arrayOnlyArgs, "array-only args should succeed"); assertions += 1;
    assert.deepEqual((arrayOnlyArgs.output as ToolCase["output"]).args.list, ["resolved-openai_api_key", "resolved-github_token", "x"], "rewrites arrays without command/cmd fields"); assertions += 1;

    const objectOnlyArgs = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c25", args: { command: "echo ok" } },
        output: { args: { headers: { Authorization: "Bearer {{SECRET:OPENAI_API_KEY}}" } } },
    });
    assertNoError(objectOnlyArgs, "object-only args should succeed"); assertions += 1;
    assert.equal(((objectOnlyArgs.output as ToolCase["output"]).args.headers as { Authorization: string }).Authorization, "Bearer resolved-openai_api_key", "rewrites object-only args without changing shape"); assertions += 1;

    const commandArgumentsMultiplePlaceholders = runHookCase({
        kind: "command",
        input: {
            command: "node cli.js",
            arguments: "--a={{SECRET:OPENAI_API_KEY}} --b={{SECRET:GITHUB_TOKEN}}",
            sessionID: "child-session",
        },
        output: { parts: [] },
    });
    assertNoError(commandArgumentsMultiplePlaceholders, "command arguments multiple placeholders should succeed"); assertions += 1;
    assert.equal(
        (commandArgumentsMultiplePlaceholders.input as CommandCase["input"]).arguments,
        "--a=resolved-openai_api_key --b=resolved-github_token",
        "rewrites multiple placeholders inside command arguments",
    ); assertions += 1;

    const commandMixedNoFetchForPlainArgument = runHookCase({
        kind: "command",
        input: { command: "node cli.js", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assertNoError(commandMixedNoFetchForPlainArgument, "plain command+args should succeed"); assertions += 1;
    assertNoFetch(commandMixedNoFetchForPlainArgument, "plain command+args should not fetch"); assertions += 1;

    const inputOnlyNestedMutation = runHookCase({
        kind: "tool",
        input: {
            tool: "bash",
            sessionID: "child-session",
            callID: "c26",
            args: { metadata: { nested: "token={{SECRET:OPENAI_API_KEY}}" } },
        },
        output: { args: { result: "ok" } },
    });
    assertNoError(inputOnlyNestedMutation, "input-only nested mutation should succeed"); assertions += 1;
    assert.equal((((inputOnlyNestedMutation.input as ToolCase["input"]).args?.metadata as { nested: string }).nested), "token=resolved-openai_api_key", "rewrites nested strings in input args too"); assertions += 1;

    const outputOnlyDuplicateButDifferentStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "c27", args: { command: "echo ok" } },
        output: {
            args: {
                one: "A={{SECRET:OPENAI_API_KEY}}",
                two: "B={{SECRET:OPENAI_API_KEY}}",
            },
        },
    });
    assertNoError(outputOnlyDuplicateButDifferentStrings, "different strings with same key should succeed"); assertions += 1;
    assertFetchCalls(
        outputOnlyDuplicateButDifferentStrings,
        ["A={{SECRET:OPENAI_API_KEY}}", "B={{SECRET:OPENAI_API_KEY}}"],
        "treats distinct strings as distinct resolution requests",
    ); assertions += 1;

    const commandRootSessionNoParent = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:OPENAI_API_KEY}}", arguments: "", sessionID: "root-session" },
        output: { parts: [] },
    });
    assertNoError(commandRootSessionNoParent, "root session command should succeed"); assertions += 1;
    assert.deepEqual(
        commandRootSessionNoParent.fetchCalls,
        [{ authorization: "Bearer root-session", text: "echo {{SECRET:OPENAI_API_KEY}}" }],
        "uses root session token directly when already at root",
    ); assertions += 1;

    console.log(`Secret proxy plugin tests passed: ${assertions}`);
}

main();

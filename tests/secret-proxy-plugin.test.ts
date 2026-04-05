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
        command: payload.output?.args?.command ?? payload.output?.args?.cmd ?? "",
        args: payload.output?.args ?? {},
      },
      shellOutput
    );
  } else {
    await hooks["command.execute.before"](payload.input, payload.output);
    await hooks["shell.env"](
      {
        sessionID: payload.input.sessionID,
        cwd: process.cwd(),
        command: payload.input.command,
        arguments: payload.input.arguments,
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

function main(): void {
    let assertions = 0;

    const curlCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "1", args: { command: "curl https://api.example.com/{{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "curl https://api.example.com/{{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((curlCommand.output as ToolCase["output"]).args.command, "curl https://api.example.com/${TC_SECRET_OPENAI_API_KEY}"); assertions += 1;
    assert.equal((curlCommand.input as ToolCase["input"]).args?.command, "curl https://api.example.com/${TC_SECRET_OPENAI_API_KEY}"); assertions += 1;
    assertFetchKeys(curlCommand, ["OPENAI_API_KEY"], "injects env only for referenced curl URL secrets"); assertions += 1;
    assert.deepEqual(curlCommand.shellEnv, { TC_SECRET_OPENAI_API_KEY: "resolved-openai_api_key" }); assertions += 1;

    const curlHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "2", args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((curlHeader.output as ToolCase["output"]).args.cmd, "curl -H \"Authorization: Bearer \${TC_SECRET_API_TOKEN}\" https://example.com"); assertions += 1;
    assertFetchKeys(curlHeader, ["API_TOKEN"], "injects env for supported curl header secrets"); assertions += 1;
    assert.deepEqual(curlHeader.shellEnv, { TC_SECRET_API_TOKEN: "resolved-api_token" }); assertions += 1;

    const inlineHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "3", args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
        output: { args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
    });
    assert.equal((inlineHeader.output as ToolCase["output"]).args.command, "curl --header=Authorization:Bearer-${TC_SECRET_API_TOKEN} https://example.com"); assertions += 1;
    assertFetchKeys(inlineHeader, ["API_TOKEN"], "injects env for inline curl headers"); assertions += 1;

    const dataOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4", args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
    });
    assert.equal((dataOption.output as ToolCase["output"]).args.command, "curl -d \"{\\\"token\\\":\\\"${TC_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com"); assertions += 1;
    assertFetchKeys(dataOption, ["OPENAI_API_KEY"], "injects env for curl data payload placeholders"); assertions += 1;

    const allowedCookieHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4b", args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((allowedCookieHeader.output as ToolCase["output"]).args.command, "curl -H \"Cookie: session=${TC_SECRET_API_TOKEN}\" https://example.com"); assertions += 1;
    assertFetchKeys(allowedCookieHeader, ["API_TOKEN"], "injects env for cookie header substitution"); assertions += 1;

    const userOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "5", args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
        output: { args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
    });
    assert.equal((userOption.output as ToolCase["output"]).args.command, "curl -u user:${TC_SECRET_GITHUB_TOKEN} https://example.com"); assertions += 1;
    assertFetchKeys(userOption, ["GITHUB_TOKEN"], "injects env for curl -u values"); assertions += 1;

    const formOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6", args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
    });
    assert.equal((formOption.output as ToolCase["output"]).args.command, "curl -F \"token=${TC_SECRET_SLACK_TOKEN}\" https://example.com"); assertions += 1;
    assertFetchKeys(formOption, ["SLACK_TOKEN"], "injects env for curl form values"); assertions += 1;

    const doubleQuotedHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6a", args: { command: "curl -H \"Authorization: Bearer {{SECRET:API_TOKEN}}\" https://example.com" } },
        output: { args: { command: "curl -H \"Authorization: Bearer {{SECRET:API_TOKEN}}\" https://example.com" } },
    });
    assert.equal((doubleQuotedHeader.output as ToolCase["output"]).args.command, "curl -H \"Authorization: Bearer ${TC_SECRET_API_TOKEN}\" https://example.com"); assertions += 1;
    assertFetchKeys(doubleQuotedHeader, ["API_TOKEN"], "preserves double quotes when rewriting supported header tokens"); assertions += 1;

    const singleQuotedUrl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6b", args: { command: "curl 'https://api.example.com/{{SECRET:OPENAI_API_KEY}}?mode=full&debug=1'" } },
        output: { args: { command: "curl 'https://api.example.com/{{SECRET:OPENAI_API_KEY}}?mode=full&debug=1'" } },
    });
    assert.equal((singleQuotedUrl.output as ToolCase["output"]).args.command, "curl \"https://api.example.com/${TC_SECRET_OPENAI_API_KEY}?mode=full&debug=1\""); assertions += 1;
    assertFetchKeys(singleQuotedUrl, ["OPENAI_API_KEY"], "converts single-quoted curl URL tokens to double quotes for env expansion"); assertions += 1;

    const multiPlaceholderAllowedHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6c", args: { command: "curl -H 'X-Api-Key: a={{SECRET:OPENAI_API_KEY}};b={{SECRET:GITHUB_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: a={{SECRET:OPENAI_API_KEY}};b={{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assert.equal((multiPlaceholderAllowedHeader.output as ToolCase["output"]).args.command, "curl -H \"X-Api-Key: a=${TC_SECRET_OPENAI_API_KEY};b=${TC_SECRET_GITHUB_TOKEN}\" https://example.com"); assertions += 1;
    assertFetchKeys(multiPlaceholderAllowedHeader, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "rewrites multiple placeholders inside one allowed single-quoted header token"); assertions += 1;

    const multiPlaceholderJsonData = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6d", args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\",\"backup\":\"{{SECRET:GITHUB_TOKEN}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\",\"backup\":\"{{SECRET:GITHUB_TOKEN}}\"}' https://example.com" } },
    });
    assert.equal((multiPlaceholderJsonData.output as ToolCase["output"]).args.command, "curl -d \"{\\\"token\\\":\\\"${TC_SECRET_OPENAI_API_KEY}\\\",\\\"backup\\\":\\\"${TC_SECRET_GITHUB_TOKEN}\\\"}\" https://example.com"); assertions += 1;
    assertFetchKeys(multiPlaceholderJsonData, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "rewrites multiple placeholders inside single-quoted JSON payloads"); assertions += 1;

    const backtickEscapingHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6e", args: { command: "curl -H 'X-Api-Key: prefix`{{SECRET:OPENAI_API_KEY}}`suffix' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: prefix`{{SECRET:OPENAI_API_KEY}}`suffix' https://example.com" } },
    });
    assert.equal((backtickEscapingHeader.output as ToolCase["output"]).args.command, "curl -H \"X-Api-Key: prefix\\`${TC_SECRET_OPENAI_API_KEY}\\`suffix\" https://example.com"); assertions += 1;
    assertFetchKeys(backtickEscapingHeader, ["OPENAI_API_KEY"], "escapes backticks when converting single-quoted header tokens to double quotes"); assertions += 1;

    const backslashEscapingHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6f", args: { command: "curl -H 'X-Api-Key: path\\\\{{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: path\\\\{{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((backslashEscapingHeader.output as ToolCase["output"]).args.command, "curl -H \"X-Api-Key: path\\\\\\\\${TC_SECRET_OPENAI_API_KEY}\" https://example.com"); assertions += 1;
    assertFetchKeys(backslashEscapingHeader, ["OPENAI_API_KEY"], "escapes backslashes when converting single-quoted header tokens to double quotes"); assertions += 1;

    const embeddedDoubleQuoteEscaping = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6g", args: { command: "curl -d '{\"note\":\"say \\\"hi\\\" to {{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"note\":\"say \\\"hi\\\" to {{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
    });
    assert.equal((embeddedDoubleQuoteEscaping.output as ToolCase["output"]).args.command, "curl -d \"{\\\"note\\\":\\\"say \\\\\\\"hi\\\\\\\" to ${TC_SECRET_OPENAI_API_KEY}\\\"}\" https://example.com"); assertions += 1;
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
    assert.equal((mixedSafeUnsafe.output as ToolCase["output"]).args.command, "curl -H \"Authorization: Bearer \${TC_SECRET_OPENAI_API_KEY}\" --output {{SECRET:GITHUB_TOKEN}} https://example.com"); assertions += 1;
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
    assert.equal(((nestedCurlString.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "curl -H \"X-Api-Key: ${TC_SECRET_OPENAI_API_KEY}\" https://example.com"); assertions += 1;
    assertFetchKeys(nestedCurlString, ["OPENAI_API_KEY"], "injects env for nested curl strings"); assertions += 1;

    const arrayCurlString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "13", args: { command: "echo ok" } },
        output: { args: { parts: ["curl https://example.com/{{SECRET:OPENAI_API_KEY}}", "echo {{SECRET:GITHUB_TOKEN}}"] } },
    });
    assert.deepEqual((arrayCurlString.output as ToolCase["output"]).args.parts, ["curl https://example.com/${TC_SECRET_OPENAI_API_KEY}", "echo {{SECRET:GITHUB_TOKEN}}"]); assertions += 1;
    assertFetchKeys(arrayCurlString, ["OPENAI_API_KEY"], "injects env only for curl strings inside arrays"); assertions += 1;

    const differentHeaderStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "15", args: { command: "echo ok" } },
        output: { args: { one: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", two: "curl -H 'X-Api-Key: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assertFetchKeys(differentHeaderStrings, ["GITHUB_TOKEN", "OPENAI_API_KEY"], "injects env for all distinct supported keys in one pass"); assertions += 1;
    assert.deepEqual(differentHeaderStrings.shellEnv, {
        TC_SECRET_GITHUB_TOKEN: "resolved-github_token",
        TC_SECRET_OPENAI_API_KEY: "resolved-openai_api_key",
    }); assertions += 1;

    const chainedCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "17", args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
        output: { args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
    });
    assert.equal((chainedCommand.output as ToolCase["output"]).args.command, "echo start && curl -H \"X-Api-Key: ${TC_SECRET_OPENAI_API_KEY}\" https://example.com && echo done"); assertions += 1;
    assertFetchKeys(chainedCommand, ["OPENAI_API_KEY"], "injects env for chained curl segments"); assertions += 1;

    const pathToCurl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "grandchild-session", callID: "20", args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((pathToCurl.output as ToolCase["output"]).args.command, "/usr/bin/curl -H \"X-Api-Key: ${TC_SECRET_OPENAI_API_KEY}\" https://example.com"); assertions += 1;
    assertFetchKeys(pathToCurl, ["OPENAI_API_KEY"], "resolves root session through multiple parents for shell env"); assertions += 1;

    const nonBashTool = runHookCase({
        kind: "tool",
        input: { tool: "task", sessionID: "child-session", callID: "21", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((nonBashTool.output as ToolCase["output"]).args.command, "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(nonBashTool, "does not run on non-bash tools"); assertions += 1;

    const commandExecutableCurl = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableCurl.input as CommandCase["input"]).arguments, "-H \"Authorization: Bearer ${TC_SECRET_OPENAI_API_KEY}\" https://example.com"); assertions += 1;
    assertFetchKeys(commandExecutableCurl, ["OPENAI_API_KEY"], "injects env for command hook curl arguments"); assertions += 1;

    const commandWithMixedArguments = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandWithMixedArguments.input as CommandCase["input"]).arguments, "-H \"Authorization: Bearer ${TC_SECRET_OPENAI_API_KEY}\" --output {{SECRET:GITHUB_TOKEN}} https://example.com"); assertions += 1;
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
    assert.equal((toolMissingKey.output as ToolCase["output"]).args.command, "curl -H \"X-Api-Key: ${TC_SECRET_MISSING_KEY}\" https://example.com"); assertions += 1;
    assert.equal(toolMissingKey.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;

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
        input: { tool: "bash", sessionID: "child-session", callID: "26", args: { command: "echo $TC_SECRET_OPENAI_API_KEY" } },
        output: { args: { command: "echo $TC_SECRET_OPENAI_API_KEY" } },
    });
    assert.equal(directSecretEnvReferenceTool.error, "Direct TC_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceTool, "rejects direct shell-style secret env references before any resolution"); assertions += 1;

    const directSecretEnvReferenceBracedTool = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "27", args: { command: "echo ${TC_SECRET_OPENAI_API_KEY}" } },
        output: { args: { command: "echo ${TC_SECRET_OPENAI_API_KEY}" } },
    });
    assert.equal(directSecretEnvReferenceBracedTool.error, "Direct TC_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceBracedTool, "rejects direct braced secret env references before any resolution"); assertions += 1;

    const directSecretEnvReferenceCommandHook = runHookCase({
        kind: "command",
        input: { command: "echo $TC_SECRET_OPENAI_API_KEY", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal(directSecretEnvReferenceCommandHook.error, "Direct TC_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."); assertions += 1;
    assertNoFetch(directSecretEnvReferenceCommandHook, "rejects direct secret env references in command hook input"); assertions += 1;

    console.log(`Secret proxy plugin tests passed: ${assertions}`);
}

main();

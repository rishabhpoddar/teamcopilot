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

function assertNoFetch(result: HookResult, label: string): void {
    assert.deepEqual(result.fetchCalls, [], label);
}

function assertFetchTexts(result: HookResult, expectedTexts: string[], label: string): void {
    assert.deepEqual(
        result.fetchCalls,
        expectedTexts.map((text) => ({ authorization: "Bearer root-session", text })),
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
    assert.equal((curlCommand.output as ToolCase["output"]).args.command, "curl https://api.example.com/resolved-openai_api_key"); assertions += 1;
    assert.equal((curlCommand.input as ToolCase["input"]).args?.command, "curl https://api.example.com/resolved-openai_api_key"); assertions += 1;
    assertFetchTexts(curlCommand, ["https://api.example.com/{{SECRET:OPENAI_API_KEY}}"], "substitutes bare curl URL tokens"); assertions += 1;

    const curlCmdField = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "2", args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { cmd: "curl -H 'Authorization: Bearer {{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((curlCmdField.output as ToolCase["output"]).args.cmd, "curl -H 'Authorization: Bearer resolved-api_token' https://example.com"); assertions += 1;
    assertFetchTexts(curlCmdField, ["Authorization: Bearer {{SECRET:API_TOKEN}}"], "substitutes curl header values"); assertions += 1;

    const inlineHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "3", args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
        output: { args: { command: "curl --header=Authorization:Bearer-{{SECRET:API_TOKEN}} https://example.com" } },
    });
    assert.equal((inlineHeader.output as ToolCase["output"]).args.command, "curl --header=Authorization:Bearer-resolved-api_token https://example.com"); assertions += 1;
    assertFetchTexts(inlineHeader, ["Authorization:Bearer-{{SECRET:API_TOKEN}}"], "substitutes inline curl --header values"); assertions += 1;

    const dataOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4", args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
        output: { args: { command: "curl -d '{\"token\":\"{{SECRET:OPENAI_API_KEY}}\"}' https://example.com" } },
    });
    assert.equal((dataOption.output as ToolCase["output"]).args.command, "curl -d '{\"token\":\"resolved-openai_api_key\"}' https://example.com"); assertions += 1;
    assertFetchTexts(dataOption, ['{"token":"{{SECRET:OPENAI_API_KEY}}"}'], "substitutes curl -d payload values"); assertions += 1;

    const caseInsensitiveHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4a", args: { command: "curl -H 'aUtHoRiZaTiOn: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'aUtHoRiZaTiOn: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((caseInsensitiveHeader.output as ToolCase["output"]).args.command, "curl -H 'aUtHoRiZaTiOn: Bearer resolved-openai_api_key' https://example.com"); assertions += 1;
    assertFetchTexts(caseInsensitiveHeader, ["aUtHoRiZaTiOn: Bearer {{SECRET:OPENAI_API_KEY}}"], "matches allowed header names case-insensitively"); assertions += 1;

    const allowedCookieHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4b", args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'Cookie: session={{SECRET:API_TOKEN}}' https://example.com" } },
    });
    assert.equal((allowedCookieHeader.output as ToolCase["output"]).args.command, "curl -H 'Cookie: session=resolved-api_token' https://example.com"); assertions += 1;
    assertFetchTexts(allowedCookieHeader, ["Cookie: session={{SECRET:API_TOKEN}}"], "allows cookie header substitution"); assertions += 1;

    const allowedPrivateTokenHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4c", args: { command: "curl -H 'PRIVATE-TOKEN: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'PRIVATE-TOKEN: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assert.equal((allowedPrivateTokenHeader.output as ToolCase["output"]).args.command, "curl -H 'PRIVATE-TOKEN: resolved-github_token' https://example.com"); assertions += 1;
    assertFetchTexts(allowedPrivateTokenHeader, ["PRIVATE-TOKEN: {{SECRET:GITHUB_TOKEN}}"], "allows additional auth-like headers case-insensitively"); assertions += 1;

    const allowedHasuraHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4d", args: { command: "curl -H 'X-Hasura-Admin-Secret: {{SECRET:SLACK_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Hasura-Admin-Secret: {{SECRET:SLACK_TOKEN}}' https://example.com" } },
    });
    assert.equal((allowedHasuraHeader.output as ToolCase["output"]).args.command, "curl -H 'X-Hasura-Admin-Secret: resolved-slack_token' https://example.com"); assertions += 1;
    assertFetchTexts(allowedHasuraHeader, ["X-Hasura-Admin-Secret: {{SECRET:SLACK_TOKEN}}"], "allows hasura admin secret headers"); assertions += 1;

    const disallowedHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4e", args: { command: "curl -H 'X-Custom-Debug: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Custom-Debug: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((disallowedHeader.output as ToolCase["output"]).args.command, "curl -H 'X-Custom-Debug: {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(disallowedHeader, "does not substitute disallowed custom headers"); assertions += 1;

    const disallowedInlineHeader = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "4f", args: { command: "curl --header=X-Custom-Debug:{{SECRET:OPENAI_API_KEY}} https://example.com" } },
        output: { args: { command: "curl --header=X-Custom-Debug:{{SECRET:OPENAI_API_KEY}} https://example.com" } },
    });
    assert.equal((disallowedInlineHeader.output as ToolCase["output"]).args.command, "curl --header=X-Custom-Debug:{{SECRET:OPENAI_API_KEY}} https://example.com"); assertions += 1;
    assertNoFetch(disallowedInlineHeader, "does not substitute disallowed inline custom headers"); assertions += 1;

    const userOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "5", args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
        output: { args: { command: "curl -u user:{{SECRET:GITHUB_TOKEN}} https://example.com" } },
    });
    assert.equal((userOption.output as ToolCase["output"]).args.command, "curl -u user:resolved-github_token https://example.com"); assertions += 1;
    assertFetchTexts(userOption, ["user:{{SECRET:GITHUB_TOKEN}}"], "substitutes curl -u values"); assertions += 1;

    const formOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "6", args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -F 'token={{SECRET:SLACK_TOKEN}}' https://example.com" } },
    });
    assert.equal((formOption.output as ToolCase["output"]).args.command, "curl -F 'token=resolved-slack_token' https://example.com"); assertions += 1;
    assertFetchTexts(formOption, ["token={{SECRET:SLACK_TOKEN}}"], "substitutes curl -F values"); assertions += 1;

    const unsafeOutputOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "7", args: { command: "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com" } },
        output: { args: { command: "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com" } },
    });
    assert.equal((unsafeOutputOption.output as ToolCase["output"]).args.command, "curl --output {{SECRET:OPENAI_API_KEY}} https://example.com"); assertions += 1;
    assertNoFetch(unsafeOutputOption, "does not substitute unsafe curl output targets"); assertions += 1;

    const unsafeConfigOption = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "8", args: { command: "curl --config {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "curl --config {{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((unsafeConfigOption.output as ToolCase["output"]).args.command, "curl --config {{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(unsafeConfigOption, "does not substitute unsafe curl config targets"); assertions += 1;

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
    assert.equal((mixedSafeUnsafe.output as ToolCase["output"]).args.command, "curl -H 'Authorization: Bearer resolved-openai_api_key' --output {{SECRET:GITHUB_TOKEN}} https://example.com"); assertions += 1;
    assertFetchTexts(mixedSafeUnsafe, ["Authorization: Bearer {{SECRET:OPENAI_API_KEY}}"], "substitutes only safe curl tokens in mixed commands"); assertions += 1;

    const echoCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "10", args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((echoCommand.output as ToolCase["output"]).args.command, "echo {{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(echoCommand, "does not substitute placeholders in non-curl commands"); assertions += 1;

    const nestedPlainString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "11", args: { command: "echo ok" } },
        output: { args: { metadata: { nested: "Bearer {{SECRET:OPENAI_API_KEY}}" } } },
    });
    assert.equal(((nestedPlainString.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "Bearer {{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(nestedPlainString, "does not substitute non-command nested strings"); assertions += 1;

    const nestedCurlString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "12", args: { command: "echo ok" } },
        output: { args: { metadata: { nested: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } } },
    });
    assert.equal(((nestedCurlString.output as ToolCase["output"]).args.metadata as { nested: string }).nested, "curl -H 'X-Api-Key: resolved-openai_api_key' https://example.com"); assertions += 1;
    assertFetchTexts(nestedCurlString, ["X-Api-Key: {{SECRET:OPENAI_API_KEY}}"], "substitutes nested strings only when they are curl commands"); assertions += 1;

    const arrayCurlString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "13", args: { command: "echo ok" } },
        output: { args: { parts: ["curl https://example.com/{{SECRET:OPENAI_API_KEY}}", "echo {{SECRET:GITHUB_TOKEN}}"] } },
    });
    assert.deepEqual((arrayCurlString.output as ToolCase["output"]).args.parts, ["curl https://example.com/resolved-openai_api_key", "echo {{SECRET:GITHUB_TOKEN}}"]); assertions += 1;
    assertFetchTexts(arrayCurlString, ["https://example.com/{{SECRET:OPENAI_API_KEY}}"], "substitutes only curl strings inside arrays"); assertions += 1;

    const duplicateHeaderSameString = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "14", args: { command: "echo ok" } },
        output: { args: { one: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com", two: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assertFetchTexts(duplicateHeaderSameString, ["X-Api-Key: {{SECRET:OPENAI_API_KEY}}"], "deduplicates identical supported strings"); assertions += 1;

    const differentHeaderStrings = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "15", args: { command: "echo ok" } },
        output: { args: { one: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", two: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assertFetchTexts(differentHeaderStrings, ["Authorization: Bearer {{SECRET:OPENAI_API_KEY}}", "X-Api-Key: {{SECRET:OPENAI_API_KEY}}"], "resolves distinct supported strings separately"); assertions += 1;

    const multipleHeadersSingleCurl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "16", args: { command: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' -H 'X-Api-Key: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
        output: { args: { command: "curl -H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' -H 'X-Api-Key: {{SECRET:GITHUB_TOKEN}}' https://example.com" } },
    });
    assert.equal((multipleHeadersSingleCurl.output as ToolCase["output"]).args.command, "curl -H 'Authorization: Bearer resolved-openai_api_key' -H 'X-Api-Key: resolved-github_token' https://example.com"); assertions += 1;
    assertFetchTexts(multipleHeadersSingleCurl, ["Authorization: Bearer {{SECRET:OPENAI_API_KEY}}", "X-Api-Key: {{SECRET:GITHUB_TOKEN}}"], "substitutes multiple safe curl tokens in one command"); assertions += 1;

    const chainedCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "17", args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
        output: { args: { command: "echo start && curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com && echo done" } },
    });
    assert.equal((chainedCommand.output as ToolCase["output"]).args.command, "echo start && curl -H 'X-Api-Key: resolved-openai_api_key' https://example.com && echo done"); assertions += 1;
    assertFetchTexts(chainedCommand, ["X-Api-Key: {{SECRET:OPENAI_API_KEY}}"], "substitutes curl segments inside chained shell commands"); assertions += 1;

    const pipedCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "18", args: { command: "printf hi | curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "printf hi | curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((pipedCommand.output as ToolCase["output"]).args.command, "printf hi | curl -H 'X-Api-Key: resolved-openai_api_key' https://example.com"); assertions += 1;
    assertFetchTexts(pipedCommand, ["X-Api-Key: {{SECRET:OPENAI_API_KEY}}"], "substitutes curl segments after a pipe"); assertions += 1;

    const dashDashUrl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "19", args: { command: "curl -- {{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "curl -- {{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((dashDashUrl.output as ToolCase["output"]).args.command, "curl -- resolved-openai_api_key"); assertions += 1;
    assertFetchTexts(dashDashUrl, ["{{SECRET:OPENAI_API_KEY}}"], "substitutes bare curl arguments after --"); assertions += 1;

    const pathToCurl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "grandchild-session", callID: "20", args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "/usr/bin/curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((pathToCurl.output as ToolCase["output"]).args.command, "/usr/bin/curl -H 'X-Api-Key: resolved-openai_api_key' https://example.com"); assertions += 1;
    assert.deepEqual(pathToCurl.fetchCalls, [{ authorization: "Bearer root-session", text: "X-Api-Key: {{SECRET:OPENAI_API_KEY}}" }], "resolves root session through multiple parents"); assertions += 1;

    const nonBashTool = runHookCase({
        kind: "tool",
        input: { tool: "task", sessionID: "child-session", callID: "21", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((nonBashTool.output as ToolCase["output"]).args.command, "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(nonBashTool, "does not run on non-bash tools"); assertions += 1;

    const missingSession = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "", callID: "22", args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((missingSession.output as ToolCase["output"]).args.command, "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(missingSession, "does nothing without a session id"); assertions += 1;

    const commandExecutableCurl = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableCurl.input as CommandCase["input"]).command, "curl"); assertions += 1;
    assert.equal((commandExecutableCurl.input as CommandCase["input"]).arguments, "-H 'Authorization: Bearer resolved-openai_api_key' https://example.com"); assertions += 1;
    assertFetchTexts(commandExecutableCurl, ["Authorization: Bearer {{SECRET:OPENAI_API_KEY}}"], "substitutes command.execute.before curl arguments"); assertions += 1;

    const commandExecutableCurlUnsafe = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "--output {{SECRET:OPENAI_API_KEY}} https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandExecutableCurlUnsafe.input as CommandCase["input"]).arguments, "--output {{SECRET:OPENAI_API_KEY}} https://example.com"); assertions += 1;
    assertNoFetch(commandExecutableCurlUnsafe, "does not substitute unsafe curl arguments in command hook"); assertions += 1;

    const commandFullCurlString = runHookCase({
        kind: "command",
        input: { command: "curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandFullCurlString.input as CommandCase["input"]).command, "curl -H 'X-Api-Key: resolved-openai_api_key' https://example.com"); assertions += 1;
    assert.equal((commandFullCurlString.input as CommandCase["input"]).arguments, "", "preserves empty arguments for full curl command strings"); assertions += 1;

    const commandNonCurl = runHookCase({
        kind: "command",
        input: { command: "echo {{SECRET:OPENAI_API_KEY}}", arguments: "", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandNonCurl.input as CommandCase["input"]).command, "echo {{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(commandNonCurl, "does not substitute non-curl command hook text"); assertions += 1;

    const wgetCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26a", args: { command: "wget --header='Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
        output: { args: { command: "wget --header='Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com" } },
    });
    assert.equal((wgetCommand.output as ToolCase["output"]).args.command, "wget --header='Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' https://example.com"); assertions += 1;
    assertNoFetch(wgetCommand, "does not substitute wget commands"); assertions += 1;

    const pythonInlineCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26b", args: { command: "python -c \"print('{{SECRET:OPENAI_API_KEY}}')\"" } },
        output: { args: { command: "python -c \"print('{{SECRET:OPENAI_API_KEY}}')\"" } },
    });
    assert.equal((pythonInlineCommand.output as ToolCase["output"]).args.command, "python -c \"print('{{SECRET:OPENAI_API_KEY}}')\""); assertions += 1;
    assertNoFetch(pythonInlineCommand, "does not substitute python -c commands"); assertions += 1;

    const nodeInlineCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26c", args: { command: "node -e \"console.log('{{SECRET:OPENAI_API_KEY}}')\"" } },
        output: { args: { command: "node -e \"console.log('{{SECRET:OPENAI_API_KEY}}')\"" } },
    });
    assert.equal((nodeInlineCommand.output as ToolCase["output"]).args.command, "node -e \"console.log('{{SECRET:OPENAI_API_KEY}}')\""); assertions += 1;
    assertNoFetch(nodeInlineCommand, "does not substitute node -e commands"); assertions += 1;

    const bashLcCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26d", args: { command: "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\"" } },
        output: { args: { command: "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\"" } },
    });
    assert.equal((bashLcCommand.output as ToolCase["output"]).args.command, "bash -lc \"curl -H 'X-Api-Key: {{SECRET:OPENAI_API_KEY}}' https://example.com\""); assertions += 1;
    assertNoFetch(bashLcCommand, "does not substitute nested curl embedded inside bash -lc strings"); assertions += 1;

    const redirectionCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26e", args: { command: "echo {{SECRET:OPENAI_API_KEY}} > secret.txt" } },
        output: { args: { command: "echo {{SECRET:OPENAI_API_KEY}} > secret.txt" } },
    });
    assert.equal((redirectionCommand.output as ToolCase["output"]).args.command, "echo {{SECRET:OPENAI_API_KEY}} > secret.txt"); assertions += 1;
    assertNoFetch(redirectionCommand, "does not substitute redirected echo commands"); assertions += 1;

    const teeCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26f", args: { command: "printf '{{SECRET:OPENAI_API_KEY}}' | tee secret.txt" } },
        output: { args: { command: "printf '{{SECRET:OPENAI_API_KEY}}' | tee secret.txt" } },
    });
    assert.equal((teeCommand.output as ToolCase["output"]).args.command, "printf '{{SECRET:OPENAI_API_KEY}}' | tee secret.txt"); assertions += 1;
    assertNoFetch(teeCommand, "does not substitute tee pipelines"); assertions += 1;

    const scpCommand = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26g", args: { command: "scp file.txt user@host:{{SECRET:OPENAI_API_KEY}}" } },
        output: { args: { command: "scp file.txt user@host:{{SECRET:OPENAI_API_KEY}}" } },
    });
    assert.equal((scpCommand.output as ToolCase["output"]).args.command, "scp file.txt user@host:{{SECRET:OPENAI_API_KEY}}"); assertions += 1;
    assertNoFetch(scpCommand, "does not substitute scp commands"); assertions += 1;

    const plainArrayNonCurl = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26h", args: { command: "echo ok" } },
        output: { args: { items: ["echo {{SECRET:OPENAI_API_KEY}}", "python -c \"print('{{SECRET:GITHUB_TOKEN}}')\""] } },
    });
    assert.deepEqual((plainArrayNonCurl.output as ToolCase["output"]).args.items, ["echo {{SECRET:OPENAI_API_KEY}}", "python -c \"print('{{SECRET:GITHUB_TOKEN}}')\""]); assertions += 1;
    assertNoFetch(plainArrayNonCurl, "does not substitute non-curl strings inside arrays"); assertions += 1;

    const toolMissingKey = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "23", args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com" } },
    });
    assert.equal(toolMissingKey.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;

    const toolMultipleMissingKeys = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "24", args: { command: "curl -H 'Authorization: Bearer {{SECRET:MISSING_KEY}}' -H 'X-Api-Key: {{SECRET:MISSING_OTHER_KEY}}' https://example.com" } },
        output: { args: { command: "curl -H 'Authorization: Bearer {{SECRET:MISSING_KEY}}' -H 'X-Api-Key: {{SECRET:MISSING_OTHER_KEY}}' https://example.com" } },
    });
    assert.equal(toolMultipleMissingKeys.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;
    assertFetchTexts(toolMultipleMissingKeys, ["Authorization: Bearer {{SECRET:MISSING_KEY}}"], "stops at the first failing supported curl token"); assertions += 1;

    const toolApiFailure = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "25", args: { command: "curl -H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com" } },
        output: { args: { command: "curl -H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com" } },
    });
    assert.equal(toolApiFailure.error, "Internal secret resolution failure"); assertions += 1;

    const commandMissingKey = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'X-Api-Key: {{SECRET:MISSING_KEY}}' https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal(commandMissingKey.error, "This command references missing secrets: MISSING_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets before retrying."); assertions += 1;

    const commandApiFailure = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'X-Api-Key: {{SECRET:API_FAIL}}' https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal(commandApiFailure.error, "Internal secret resolution failure"); assertions += 1;

    const plainPayloadPreserved = runHookCase({
        kind: "tool",
        input: { tool: "bash", sessionID: "child-session", callID: "26", args: { cwd: "/tmp", script: "echo hi" } as Record<string, unknown> },
        output: { args: { cwd: "/tmp", script: "echo hi", nested: { count: 1, ok: true }, list: [1, false, null] } },
    });
    assert.deepEqual((plainPayloadPreserved.output as ToolCase["output"]).args, { cwd: "/tmp", script: "echo hi", nested: { count: 1, ok: true }, list: [1, false, null] }); assertions += 1;
    assertNoFetch(plainPayloadPreserved, "preserves plain non-curl payloads exactly"); assertions += 1;

    const commandWithMixedArguments = runHookCase({
        kind: "command",
        input: { command: "curl", arguments: "-H 'Authorization: Bearer {{SECRET:OPENAI_API_KEY}}' --output {{SECRET:GITHUB_TOKEN}} https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandWithMixedArguments.input as CommandCase["input"]).arguments, "-H 'Authorization: Bearer resolved-openai_api_key' --output {{SECRET:GITHUB_TOKEN}} https://example.com"); assertions += 1;
    assertFetchTexts(commandWithMixedArguments, ["Authorization: Bearer {{SECRET:OPENAI_API_KEY}}"], "substitutes only safe command-hook curl arguments"); assertions += 1;

    const commandWithPathExecutable = runHookCase({
        kind: "command",
        input: { command: "/usr/bin/curl", arguments: "--header=X-Api-Key:{{SECRET:OPENAI_API_KEY}} https://example.com", sessionID: "child-session" },
        output: { parts: [] },
    });
    assert.equal((commandWithPathExecutable.input as CommandCase["input"]).arguments, "--header=X-Api-Key:resolved-openai_api_key https://example.com"); assertions += 1;
    assertFetchTexts(commandWithPathExecutable, ["X-Api-Key:{{SECRET:OPENAI_API_KEY}}"], "supports path-based curl executables in command hook"); assertions += 1;

    console.log(`Secret proxy plugin tests passed: ${assertions}`);
}

main();

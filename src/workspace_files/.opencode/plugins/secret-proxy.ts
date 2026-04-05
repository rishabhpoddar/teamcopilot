import type { Plugin } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}

interface SessionLookupResponse {
  error?: unknown
  data?: {
    id?: string
    parentID?: string
  }
}

type SecretMapResolutionResponse = {
  secret_map?: Record<string, string>
}

const SECRET_PLACEHOLDER_PATTERN = /\{\{SECRET:([A-Za-z_][A-Za-z0-9_]*)\}\}/g
const SECRET_ENV_REFERENCE_PATTERN = /\$\{__TEAMCOPILOT_RUNTIME_SECRET_([A-Z][A-Z0-9_]*)\}/g
const AGENT_VISIBLE_SECRET_ENV_REFERENCE_PATTERN = /__TEAMCOPILOT_RUNTIME_SECRET_[A-Z][A-Z0-9_]*/
const SECRET_ENV_PREFIX = "__TEAMCOPILOT_RUNTIME_SECRET_"
const SHELL_CONTROL_TOKENS = new Set(["&&", "||", ";", "|"])
const CURL_SAFE_VALUE_OPTIONS = new Set([
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "-u",
  "--user",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-b",
  "--cookie",
  "-F",
  "--form",
  "--form-string",
  "--url",
  "-x",
  "--proxy",
  "-U",
  "--proxy-user",
  "--oauth2-bearer",
  "--request-target",
  "--resolve",
  "--connect-to",
])
const CURL_UNSAFE_VALUE_OPTIONS = new Set([
  "-o",
  "--output",
  "-O",
  "--remote-name",
  "--output-dir",
  "-D",
  "--dump-header",
  "-K",
  "--config",
  "-w",
  "--write-out",
  "-E",
  "--cert",
  "--key",
  "--proxy-key",
  "--stderr",
  "--trace",
  "--trace-ascii",
  "--trace-config",
])
const CURL_ALLOWED_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "x-authorization",
  "x-token",
  "x-session-token",
  "x-authentication-token",
  "authentication",
  "x-csrf-token",
  "x-xsrf-token",
  "csrf-token",
  "xsrf-token",
  "cookie",
  "set-cookie",
  "www-authenticate",
  "x-amz-security-token",
  "x-amz-content-sha256",
  "x-goog-api-key",
  "x-goog-authuser",
  "x-ms-client-principal",
  "x-ms-token-aad-access-token",
  "cf-access-jwt-assertion",
  "x-parse-rest-api-key",
  "x-parse-master-key",
  "x-hasura-admin-secret",
  "x-hasura-access-key",
  "x-supabase-api-key",
  "x-supabase-auth",
  "x-notion-secret",
  "x-appwrite-project",
  "x-appwrite-key",
  "x-elastic-api-key",
  "private-token",
  "job-token",
  "circle-token",
  "x-circleci-token",
  "x-airtable-api-key",
])

function readSessionLookupErrorMessage(error: unknown, fallbackMessage: string): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim().length > 0) {
      return message
    }
  }
  return fallbackMessage
}

async function readErrorMessageFromResponse(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return fallbackMessage
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        const msg = (parsed as { message?: unknown }).message
        if (typeof msg === "string" && msg.trim().length > 0) return msg
      }
    } catch {
      // fall back to plain text
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

function tokenizeCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|&&|\|\||[;|]|[^\s]+/g) ?? []
}

function unwrapToken(rawToken: string): { quote: '"' | "'" | null; inner: string } {
  if (rawToken.length >= 2) {
    const first = rawToken[0]
    const last = rawToken[rawToken.length - 1]
    if ((first === "\"" || first === "'") && first === last) {
      return {
        quote: first,
        inner: rawToken.slice(1, -1),
      }
    }
  }

  return {
    quote: null,
    inner: rawToken,
  }
}

function wrapToken(quote: '"' | "'" | null, inner: string): string {
  return quote ? `${quote}${inner}${quote}` : inner
}

function escapeForDoubleQuotedShell(inner: string): string {
  return inner.replace(/[\\`"]/g, "\\$&")
}

function wrapTokenForShellExpansion(
  originalQuote: '"' | "'" | null,
  inner: string,
  substituted: boolean
): string {
  if (!substituted) {
    return wrapToken(originalQuote, inner)
  }
  if (originalQuote === "'") {
    return `"${escapeForDoubleQuotedShell(inner)}"`
  }
  return wrapToken(originalQuote, inner)
}

function normalizeSecretKey(rawKey: string): string {
  return rawKey.trim().toUpperCase()
}

function toSecretEnvReference(key: string): string {
  return `\${${SECRET_ENV_PREFIX}${key}}`
}

function replacePlaceholdersWithEnvRefs(value: string): { rewritten: string; referencedKeys: string[] } {
  const referencedKeys: string[] = []
  const seen = new Set<string>()
  const rewritten = value.replace(SECRET_PLACEHOLDER_PATTERN, (_match, rawKey: string) => {
    const key = normalizeSecretKey(rawKey)
    if (!seen.has(key)) {
      seen.add(key)
      referencedKeys.push(key)
    }
    return toSecretEnvReference(key)
  })

  return {
    rewritten,
    referencedKeys,
  }
}

function isCurlExecutableToken(rawToken: string): boolean {
  const { inner } = unwrapToken(rawToken)
  const base = inner.split("/").pop() ?? inner
  return base === "curl"
}

function getLongOptionName(inner: string): string | null {
  const eqIndex = inner.indexOf("=")
  const optionName = eqIndex === -1 ? inner : inner.slice(0, eqIndex)
  return optionName.startsWith("--") ? optionName : null
}

function isSafeCurlOption(inner: string): boolean {
  const optionName = getLongOptionName(inner) ?? inner
  return CURL_SAFE_VALUE_OPTIONS.has(optionName)
}

function isUnsafeCurlOption(inner: string): boolean {
  const optionName = getLongOptionName(inner) ?? inner
  return CURL_UNSAFE_VALUE_OPTIONS.has(optionName)
}

function normalizeHeaderName(headerName: string): string {
  return headerName.trim().toLowerCase()
}

function isAllowedCurlHeaderValue(value: string): boolean {
  const colonIndex = value.indexOf(":")
  if (colonIndex === -1) {
    return false
  }

  const headerName = normalizeHeaderName(value.slice(0, colonIndex))
  return CURL_ALLOWED_HEADER_NAMES.has(headerName)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function collectReferencedEnvKeys(value: unknown, found: Set<string>): void {
  if (typeof value === "string") {
    let match: RegExpExecArray | null
    SECRET_ENV_REFERENCE_PATTERN.lastIndex = 0
    while ((match = SECRET_ENV_REFERENCE_PATTERN.exec(value)) !== null) {
      found.add(match[1]!)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedEnvKeys(item, found)
    }
    return
  }

  if (!isPlainObject(value)) {
    return
  }

  for (const nestedValue of Object.values(value)) {
    collectReferencedEnvKeys(nestedValue, found)
  }
}

function assertNoAgentAuthoredSecretEnvReference(value: unknown): void {
  if (typeof value === "string") {
        if (AGENT_VISIBLE_SECRET_ENV_REFERENCE_PATTERN.test(value)) {
          throw new Error(
        "Agent-authored __TEAMCOPILOT_RUNTIME_SECRET_* references are not allowed. Use {{SECRET:KEY}} placeholders instead."
          )
        }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoAgentAuthoredSecretEnvReference(item)
    }
    return
  }

  if (!isPlainObject(value)) {
    return
  }

  for (const nestedValue of Object.values(value)) {
    assertNoAgentAuthoredSecretEnvReference(nestedValue)
  }
}

export const SecretProxyPlugin: Plugin = async ({ client }) => {
  const pendingEnvKeysBySession = new Map<string, Set<string>>()

  function addPendingEnvKeys(sessionID: string, keys: string[]): void {
    if (keys.length === 0) {
      return
    }

    const existing = pendingEnvKeysBySession.get(sessionID) ?? new Set<string>()
    for (const key of keys) {
      existing.add(key)
    }
    pendingEnvKeysBySession.set(sessionID, existing)
  }

  async function resolveRootSessionID(sessionID: string): Promise<string> {
    let currentSessionID = sessionID

    while (true) {
      const response = (await client.session.get({
        path: {
          id: currentSessionID,
        },
      })) as SessionLookupResponse
      if (response.error) {
        throw new Error(
          readSessionLookupErrorMessage(
            response.error,
            `Failed to resolve root session for ${currentSessionID}`
          )
        )
      }

      const parentID = response.data?.parentID
      if (!parentID) {
        return currentSessionID
      }

      currentSessionID = parentID
    }
  }

  async function resolveSecretMapForKeys(
    sessionID: string,
    keys: string[]
  ): Promise<Record<string, string>> {
    const rootSessionID = await resolveRootSessionID(sessionID)
    const response = await fetch(`${getApiBaseUrl()}/api/users/me/resolve-secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rootSessionID}`,
      },
      body: JSON.stringify({
        keys,
      }),
    })

    if (!response.ok) {
      const errorMessage = await readErrorMessageFromResponse(
        response,
        `Failed to resolve secret values for bash command (HTTP ${response.status})`
      )
      throw new Error(errorMessage)
    }

    const payload = (await response.json()) as SecretMapResolutionResponse
    return payload.secret_map ?? {}
  }

  async function rewriteStringFieldsInPlace(
    sessionID: string,
    value: unknown,
    cache: Map<string, { rewritten: string; referencedKeys: string[] }>,
  ): Promise<void> {
    if (typeof value === "string") {
      return
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index]
        if (typeof item === "string") {
          const rewritten = await maybeRewriteSupportedString(item, cache)
          value[index] = rewritten.rewritten
          addPendingEnvKeys(sessionID, rewritten.referencedKeys)
          continue
        }
        await rewriteStringFieldsInPlace(sessionID, item, cache)
      }
      return
    }

    if (!isPlainObject(value)) {
      return
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue === "string") {
        const rewritten = await maybeRewriteSupportedString(nestedValue, cache)
        value[key] = rewritten.rewritten
        addPendingEnvKeys(sessionID, rewritten.referencedKeys)
        continue
      }
      await rewriteStringFieldsInPlace(sessionID, nestedValue, cache)
    }
  }

  async function maybeRewriteSupportedString(
    text: string,
    cache: Map<string, { rewritten: string; referencedKeys: string[] }>,
  ): Promise<{ rewritten: string; referencedKeys: string[] }> {
    if (!text.includes("{{SECRET:")) {
      return {
        rewritten: text,
        referencedKeys: [],
      }
    }

    const cached = cache.get(text)
    if (cached !== undefined) {
      return cached
    }

    const rewritten = substitutePlaceholdersInCurlShellString(text)
    cache.set(text, rewritten)
    return rewritten
  }

  function rewriteTokenInner(inner: string): { rewrittenInner: string; referencedKeys: string[] } {
    return replacePlaceholdersWithEnvRefs(inner)
  }

  function rewriteRawToken(rawToken: string): { rewritten: string; referencedKeys: string[] } {
    const { quote, inner } = unwrapToken(rawToken)
    const { rewritten, referencedKeys } = rewriteTokenInner(inner)
    return {
      rewritten: wrapTokenForShellExpansion(quote, rewritten, referencedKeys.length > 0),
      referencedKeys,
    }
  }

  function rewriteRawTokenValuePortion(rawToken: string): { rewritten: string; referencedKeys: string[] } {
    const { quote, inner } = unwrapToken(rawToken)
    const eqIndex = inner.indexOf("=")
    if (eqIndex === -1) {
      return {
        rewritten: rawToken,
        referencedKeys: [],
      }
    }

    const prefix = inner.slice(0, eqIndex + 1)
    const value = inner.slice(eqIndex + 1)
    const { rewritten, referencedKeys } = rewriteTokenInner(value)
    return {
      rewritten: wrapTokenForShellExpansion(quote, `${prefix}${rewritten}`, referencedKeys.length > 0),
      referencedKeys,
    }
  }

  function rewriteHeaderTokenIfAllowed(rawToken: string): { rewritten: string; referencedKeys: string[] } {
    const { quote, inner } = unwrapToken(rawToken)
    if (!isAllowedCurlHeaderValue(inner)) {
      return {
        rewritten: rawToken,
        referencedKeys: [],
      }
    }

    const { rewritten, referencedKeys } = rewriteTokenInner(inner)
    return {
      rewritten: wrapTokenForShellExpansion(quote, rewritten, referencedKeys.length > 0),
      referencedKeys,
    }
  }

  function rewriteInlineHeaderValueIfAllowed(rawToken: string): { rewritten: string; referencedKeys: string[] } {
    const { quote, inner } = unwrapToken(rawToken)
    const eqIndex = inner.indexOf("=")
    if (eqIndex === -1) {
      return {
        rewritten: rawToken,
        referencedKeys: [],
      }
    }

    const prefix = inner.slice(0, eqIndex + 1)
    const value = inner.slice(eqIndex + 1)
    if (!isAllowedCurlHeaderValue(value)) {
      return {
        rewritten: rawToken,
        referencedKeys: [],
      }
    }

    const { rewritten, referencedKeys } = rewriteTokenInner(value)
    return {
      rewritten: wrapTokenForShellExpansion(quote, `${prefix}${rewritten}`, referencedKeys.length > 0),
      referencedKeys,
    }
  }

  function substitutePlaceholdersInCurlShellString(
    text: string,
  ): { rewritten: string; referencedKeys: string[] } {
    const rawTokens = tokenizeCommand(text)
    if (rawTokens.length === 0) {
      return {
        rewritten: text,
        referencedKeys: [],
      }
    }

    const referencedKeys = new Set<string>()
    let mutated = false
    let atCommandStart = true

    for (let index = 0; index < rawTokens.length; index += 1) {
      const rawToken = rawTokens[index]

      if (SHELL_CONTROL_TOKENS.has(rawToken)) {
        atCommandStart = true
        continue
      }

      if (!atCommandStart) {
        continue
      }

      if (!isCurlExecutableToken(rawToken)) {
        atCommandStart = false
        continue
      }

      atCommandStart = false
      let expectedValueKind: "safe" | "unsafe" | "header" | null = null

      for (let j = index + 1; j < rawTokens.length; j += 1) {
        const segmentToken = rawTokens[j]
        if (SHELL_CONTROL_TOKENS.has(segmentToken)) {
          atCommandStart = true
          index = j - 1
          break
        }

        const { inner } = unwrapToken(segmentToken)

        if (expectedValueKind !== null) {
          const rewritten = expectedValueKind === "safe"
            ? rewriteRawToken(segmentToken)
            : expectedValueKind === "header"
              ? rewriteHeaderTokenIfAllowed(segmentToken)
              : { rewritten: segmentToken, referencedKeys: [] }
          if (rewritten.rewritten !== segmentToken) {
            rawTokens[j] = rewritten.rewritten
            mutated = true
            for (const key of rewritten.referencedKeys) {
              referencedKeys.add(key)
            }
          }
          expectedValueKind = null
          continue
        }

        if (inner === "--") {
          continue
        }

        if (inner.startsWith("-")) {
          if (isUnsafeCurlOption(inner)) {
            expectedValueKind = !inner.includes("=") ? "unsafe" : null
            continue
          }

          if (isSafeCurlOption(inner)) {
            const optionName = getLongOptionName(inner) ?? inner
            if (inner.includes("=")) {
              const rewritten = optionName === "--header"
                ? rewriteInlineHeaderValueIfAllowed(segmentToken)
                : rewriteRawTokenValuePortion(segmentToken)
              if (rewritten.rewritten !== segmentToken) {
                rawTokens[j] = rewritten.rewritten
                mutated = true
                for (const key of rewritten.referencedKeys) {
                  referencedKeys.add(key)
                }
              }
            } else {
              expectedValueKind = optionName === "-H" || optionName === "--header" ? "header" : "safe"
            }
          }
          continue
        }

        const rewritten = rewriteRawToken(segmentToken)
        if (rewritten.rewritten !== segmentToken) {
          rawTokens[j] = rewritten.rewritten
          mutated = true
          for (const key of rewritten.referencedKeys) {
            referencedKeys.add(key)
          }
        }
      }
    }

    return {
      rewritten: mutated ? rawTokens.join(" ") : text,
      referencedKeys: Array.from(referencedKeys).sort(),
    }
  }

  return {
    "command.execute.before": async (input) => {
      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      assertNoAgentAuthoredSecretEnvReference(input.command)
      assertNoAgentAuthoredSecretEnvReference(input.arguments)

      const commandCache = new Map<string, { rewritten: string; referencedKeys: string[] }>()
      if (typeof input.command === "string" && input.command.includes("{{SECRET:")) {
        if (isCurlExecutableToken(input.command) && typeof input.arguments === "string") {
          const fullCurlCommand = input.arguments.trim().length > 0
            ? `${input.command} ${input.arguments}`
            : input.command
          const rewritten = substitutePlaceholdersInCurlShellString(fullCurlCommand)
          addPendingEnvKeys(sessionID, rewritten.referencedKeys)
          const prefix = `${input.command} `
          if (rewritten.rewritten.startsWith(prefix)) {
            input.arguments = rewritten.rewritten.slice(prefix.length)
          } else {
            input.command = rewritten.rewritten
            input.arguments = ""
          }
        } else {
          const rewritten = await maybeRewriteSupportedString(input.command, commandCache)
          input.command = rewritten.rewritten
          addPendingEnvKeys(sessionID, rewritten.referencedKeys)
        }
      }
      if (typeof input.arguments === "string" && input.arguments.includes("{{SECRET:")) {
        if (isCurlExecutableToken(input.command)) {
          const fullCurlCommand = input.arguments.trim().length > 0
            ? `${input.command} ${input.arguments}`
            : input.command
          const rewritten = substitutePlaceholdersInCurlShellString(fullCurlCommand)
          addPendingEnvKeys(sessionID, rewritten.referencedKeys)
          const prefix = `${input.command} `
          if (rewritten.rewritten.startsWith(prefix)) {
            input.arguments = rewritten.rewritten.slice(prefix.length)
          }
        } else {
          const rewritten = await maybeRewriteSupportedString(input.arguments, commandCache)
          input.arguments = rewritten.rewritten
          addPendingEnvKeys(sessionID, rewritten.referencedKeys)
        }
      }
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return
      }

      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      assertNoAgentAuthoredSecretEnvReference(input.args)
      assertNoAgentAuthoredSecretEnvReference(output.args)

      const cache = new Map<string, { rewritten: string; referencedKeys: string[] }>()
      await rewriteStringFieldsInPlace(sessionID, output.args, cache)
      await rewriteStringFieldsInPlace(sessionID, input.args, cache)
    },
    "shell.env": async (input, output) => {
      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      const referencedKeys = new Set<string>()
      collectReferencedEnvKeys(input, referencedKeys)
      collectReferencedEnvKeys(output, referencedKeys)

      const pendingKeys = pendingEnvKeysBySession.get(sessionID)
      if (pendingKeys) {
        for (const key of pendingKeys) {
          referencedKeys.add(key)
        }
      }

      if (referencedKeys.size === 0) {
        return
      }

      const resolvedSecretMap = await resolveSecretMapForKeys(sessionID, Array.from(referencedKeys).sort())
      for (const [key, value] of Object.entries(resolvedSecretMap)) {
        output.env[`${SECRET_ENV_PREFIX}${key}`] = value
      }
      pendingEnvKeysBySession.delete(sessionID)
    },
  }
}

export default SecretProxyPlugin

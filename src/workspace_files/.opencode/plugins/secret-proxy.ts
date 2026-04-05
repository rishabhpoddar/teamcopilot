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

type PlaceholderResolutionResponse = {
  referenced_keys?: string[]
  missing_keys?: string[]
  substituted_text?: string
}

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

export const SecretProxyPlugin: Plugin = async ({ client }) => {
  async function resolveRootSessionID(sessionID: string): Promise<string> {
    let currentSessionID = sessionID

    while (true) {
      const response = (await client.session.get({
        path: {
          id: currentSessionID,
        },
      })) as SessionLookupResponse
      if (response.error) {
        throw new Error(`Failed to resolve root session for ${currentSessionID}`)
      }

      const parentID = response.data?.parentID
      if (!parentID) {
        return currentSessionID
      }

      currentSessionID = parentID
    }
  }

  async function substituteSecretPlaceholders(sessionID: string, command: string): Promise<string> {
    const rootSessionID = await resolveRootSessionID(sessionID)
    const response = await fetch(`${getApiBaseUrl()}/api/users/me/resolve-secret-placeholders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rootSessionID}`,
      },
      body: JSON.stringify({
        text: command,
      }),
    })

    if (!response.ok) {
      const errorMessage = await readErrorMessageFromResponse(
        response,
        `Failed to resolve secret placeholders for bash command (HTTP ${response.status})`
      )
      throw new Error(errorMessage)
    }

    const payload = (await response.json()) as PlaceholderResolutionResponse
    return typeof payload.substituted_text === "string" ? payload.substituted_text : command
  }

  async function rewriteStringFieldsInPlace(
    sessionID: string,
    value: unknown,
    cache: Map<string, string>,
  ): Promise<void> {
    if (typeof value === "string") {
      return
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index]
        if (typeof item === "string") {
          value[index] = await maybeRewriteSupportedString(sessionID, item, cache)
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
        value[key] = await maybeRewriteSupportedString(sessionID, nestedValue, cache)
        continue
      }
      await rewriteStringFieldsInPlace(sessionID, nestedValue, cache)
    }
  }

  async function maybeRewriteSupportedString(
    sessionID: string,
    text: string,
    cache: Map<string, string>,
  ): Promise<string> {
    if (!text.includes("{{SECRET:")) {
      return text
    }

    const cached = cache.get(text)
    if (cached !== undefined) {
      return cached
    }

    const substituted = await substitutePlaceholdersInCurlShellString(sessionID, text, cache)
    cache.set(text, substituted)
    return substituted
  }

  async function substituteTokenInner(
    sessionID: string,
    inner: string,
    cache: Map<string, string>,
  ): Promise<string> {
    if (!inner.includes("{{SECRET:")) {
      return inner
    }

    const cached = cache.get(inner)
    if (cached !== undefined) {
      return cached
    }

    const substituted = await substituteSecretPlaceholders(sessionID, inner)
    cache.set(inner, substituted)
    return substituted
  }

  async function substituteRawToken(
    sessionID: string,
    rawToken: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const { quote, inner } = unwrapToken(rawToken)
    const substitutedInner = await substituteTokenInner(sessionID, inner, cache)
    return wrapToken(quote, substitutedInner)
  }

  async function substituteRawTokenValuePortion(
    sessionID: string,
    rawToken: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const { quote, inner } = unwrapToken(rawToken)
    const eqIndex = inner.indexOf("=")
    if (eqIndex === -1) {
      return rawToken
    }

    const prefix = inner.slice(0, eqIndex + 1)
    const value = inner.slice(eqIndex + 1)
    const substitutedValue = await substituteTokenInner(sessionID, value, cache)
    return wrapToken(quote, `${prefix}${substitutedValue}`)
  }

  async function substituteHeaderTokenIfAllowed(
    sessionID: string,
    rawToken: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const { quote, inner } = unwrapToken(rawToken)
    if (!isAllowedCurlHeaderValue(inner)) {
      return rawToken
    }

    const substitutedInner = await substituteTokenInner(sessionID, inner, cache)
    return wrapToken(quote, substitutedInner)
  }

  async function substituteInlineHeaderValueIfAllowed(
    sessionID: string,
    rawToken: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const { quote, inner } = unwrapToken(rawToken)
    const eqIndex = inner.indexOf("=")
    if (eqIndex === -1) {
      return rawToken
    }

    const prefix = inner.slice(0, eqIndex + 1)
    const value = inner.slice(eqIndex + 1)
    if (!isAllowedCurlHeaderValue(value)) {
      return rawToken
    }

    const substitutedValue = await substituteTokenInner(sessionID, value, cache)
    return wrapToken(quote, `${prefix}${substitutedValue}`)
  }

  async function substitutePlaceholdersInCurlShellString(
    sessionID: string,
    text: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const rawTokens = tokenizeCommand(text)
    if (rawTokens.length === 0) {
      return text
    }

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
          if (expectedValueKind === "safe" && inner.includes("{{SECRET:")) {
            const substituted = await substituteRawToken(sessionID, segmentToken, cache)
            if (substituted !== segmentToken) {
              rawTokens[j] = substituted
              mutated = true
            }
          }
          if (expectedValueKind === "header" && inner.includes("{{SECRET:")) {
            const substituted = await substituteHeaderTokenIfAllowed(sessionID, segmentToken, cache)
            if (substituted !== segmentToken) {
              rawTokens[j] = substituted
              mutated = true
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
              const substituted = optionName === "--header"
                ? await substituteInlineHeaderValueIfAllowed(sessionID, segmentToken, cache)
                : await substituteRawTokenValuePortion(sessionID, segmentToken, cache)
              if (substituted !== segmentToken) {
                rawTokens[j] = substituted
                mutated = true
              }
            } else {
              expectedValueKind = optionName === "-H" || optionName === "--header" ? "header" : "safe"
            }
          }
          continue
        }

        if (inner.includes("{{SECRET:")) {
          const substituted = await substituteRawToken(sessionID, segmentToken, cache)
          if (substituted !== segmentToken) {
            rawTokens[j] = substituted
            mutated = true
          }
        }
      }
    }

    return mutated ? rawTokens.join(" ") : text
  }

  return {
    "command.execute.before": async (input) => {
      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      const commandCache = new Map<string, string>()
      if (typeof input.command === "string" && input.command.includes("{{SECRET:")) {
        if (isCurlExecutableToken(input.command) && typeof input.arguments === "string") {
          const fullCurlCommand = input.arguments.trim().length > 0
            ? `${input.command} ${input.arguments}`
            : input.command
          const substituted = await substitutePlaceholdersInCurlShellString(sessionID, fullCurlCommand, commandCache)
          const prefix = `${input.command} `
          if (substituted.startsWith(prefix)) {
            input.arguments = substituted.slice(prefix.length)
          } else {
            input.command = substituted
            input.arguments = ""
          }
        } else {
          input.command = await maybeRewriteSupportedString(sessionID, input.command, commandCache)
        }
      }
      if (typeof input.arguments === "string" && input.arguments.includes("{{SECRET:")) {
        if (isCurlExecutableToken(input.command)) {
          const fullCurlCommand = input.arguments.trim().length > 0
            ? `${input.command} ${input.arguments}`
            : input.command
          const substituted = await substitutePlaceholdersInCurlShellString(sessionID, fullCurlCommand, commandCache)
          const prefix = `${input.command} `
          if (substituted.startsWith(prefix)) {
            input.arguments = substituted.slice(prefix.length)
          }
        } else {
          input.arguments = await maybeRewriteSupportedString(sessionID, input.arguments, commandCache)
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

      const cache = new Map<string, string>()
      await rewriteStringFieldsInPlace(sessionID, output.args, cache)
      await rewriteStringFieldsInPlace(sessionID, input.args, cache)
    },
  }
}

export default SecretProxyPlugin

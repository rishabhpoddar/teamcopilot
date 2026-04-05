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
          if (!item.includes("{{SECRET:")) {
            continue
          }
          const cached = cache.get(item)
          if (cached !== undefined) {
            value[index] = cached
            continue
          }
          const substituted = await substituteSecretPlaceholders(sessionID, item)
          cache.set(item, substituted)
          value[index] = substituted
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
        if (!nestedValue.includes("{{SECRET:")) {
          continue
        }
        const cached = cache.get(nestedValue)
        if (cached !== undefined) {
          value[key] = cached
          continue
        }
        const substituted = await substituteSecretPlaceholders(sessionID, nestedValue)
        cache.set(nestedValue, substituted)
        value[key] = substituted
        continue
      }
      await rewriteStringFieldsInPlace(sessionID, nestedValue, cache)
    }
  }

  return {
    "command.execute.before": async (input) => {
      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      if (typeof input.command === "string" && input.command.includes("{{SECRET:")) {
        input.command = await substituteSecretPlaceholders(sessionID, input.command)
      }
      if (typeof input.arguments === "string" && input.arguments.includes("{{SECRET:")) {
        input.arguments = await substituteSecretPlaceholders(sessionID, input.arguments)
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

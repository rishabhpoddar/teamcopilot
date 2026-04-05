import { type Plugin, tool } from "@opencode-ai/plugin"

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

export const ListAvailableSecretKeysPlugin: Plugin = async ({ client }) => {
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

  return {
    tool: {
      listAvailableSecretKeys: tool({
        description:
          "Get all secret keys available to the current user. Returns the merged key inventory after applying TeamCopilot's precedence rules: user secret first, then global secret. This tool does not return plaintext secret values.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)

          const response = await fetch(`${getApiBaseUrl()}/api/users/me/resolved-secrets`, {
            headers: {
              Authorization: `Bearer ${authSessionID}`,
            },
          })

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to get resolved secrets (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = (await response.json()) as {
            secret_keys?: string[]
            total?: number
          }

          return JSON.stringify(
            {
              secret_keys: Array.isArray(payload.secret_keys) ? payload.secret_keys : [],
              total: typeof payload.total === "number" ? payload.total : 0,
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default ListAvailableSecretKeysPlugin

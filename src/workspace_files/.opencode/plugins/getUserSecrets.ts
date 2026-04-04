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

export const GetUserSecretsPlugin: Plugin = async ({ client }) => {
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
      getUserSecrets: tool({
        description:
          "Get all resolved secrets available to the current user. Returns the merged key/value map after applying TeamCopilot's precedence rules: user secret first, then global secret.",
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
            secrets?: Array<{
              key?: string
              value?: string
            }>
          }

          const secretMap: Record<string, string> = {}
          for (const secret of payload.secrets ?? []) {
            if (typeof secret.key !== "string" || typeof secret.value !== "string") {
              continue
            }
            secretMap[secret.key] = secret.value
          }

          return JSON.stringify(
            {
              secretMap,
              total: Object.keys(secretMap).length,
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default GetUserSecretsPlugin

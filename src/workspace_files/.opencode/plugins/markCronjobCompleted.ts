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
      // fall back to text
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

export const MarkCronjobCompletedPlugin: Plugin = async ({ client }) => {
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
      markCronjobCompleted: tool({
        description:
          "Mark the current TeamCopilot cronjob run as successfully completed. Use this exactly once, and only after all requested cronjob work is complete. If you do not call this tool before the tool loop stops, TeamCopilot will reveal the cronjob session to the user as needing attention.",
        args: {
          summary: tool.schema
            .string()
            .describe("A concise summary of what the cronjob completed, suitable for the cronjob run history."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const summary = args.summary?.trim()

          if (!summary) {
            throw new Error("summary is required")
          }

          const response = await fetch(`${getApiBaseUrl()}/api/cronjobs/runs/complete-current`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSessionID}`,
            },
            body: JSON.stringify({ summary }),
          })

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to mark cronjob completed (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          return JSON.stringify({ success: true, summary })
        },
      }),
    },
  }
}

export default MarkCronjobCompletedPlugin

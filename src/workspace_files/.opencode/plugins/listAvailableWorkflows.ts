import { type Plugin, tool } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}



interface WorkflowSummary {
  slug: string
  name: string
  intent_summary: string
  is_approved: boolean
  can_edit: boolean
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

export const ListAvailableWorkflowsPlugin: Plugin = async ({ client }) => {
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
      listAvailableWorkflows: tool({
        description:
          "List workflows that are available for this user to use. Returns all workflows the current user can access, including those pending approval.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)

          const response = await fetch(`${getApiBaseUrl()}/api/workflows`, {
            headers: {
              Authorization: `Bearer ${authSessionID}`,
            },
          })

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to list workflows (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = (await response.json()) as {
            workflows?: WorkflowSummary[]
          }

          const availableWorkflows = (payload.workflows ?? [])
            .map((workflow) => ({
              path: `workflows/${workflow.slug}`,
              slug: workflow.slug,
              name: workflow.name,
              intent_summary: workflow.intent_summary,
              is_approved: workflow.is_approved,
            }))

          return JSON.stringify(
            {
              workflows: availableWorkflows,
              total: availableWorkflows.length,
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default ListAvailableWorkflowsPlugin

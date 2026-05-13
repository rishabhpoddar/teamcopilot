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

async function postJson(path: string, authSessionID: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSessionID}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorMessage = await readErrorMessageFromResponse(
      response,
      `Cronjob todo tool failed (HTTP ${response.status})`
    )
    throw new Error(errorMessage)
  }

  return response.json()
}

export const ManageCronjobTodosPlugin: Plugin = async ({ client }) => {
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
      setCronjobTodos: tool({
        description:
          "Create the initial TeamCopilot cronjob todo list. Use this before doing cronjob task work. After this succeeds, wait for TeamCopilot to give you the first current todo item.",
        args: {
          items: tool.schema
            .array(tool.schema.string())
            .describe("Granular todo items required to complete the cronjob task."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/set-current", authSessionID, {
            items: args.items,
          }))
        },
      }),
      addCronjobTodos: tool({
        description:
          "Add newly discovered todo items to the current TeamCopilot cronjob run. index 0 inserts the new items as the next pending todos after the current todo is finished. Omit index to append to the end.",
        args: {
          items: tool.schema
            .array(tool.schema.string())
            .describe("New todo items required to complete the cronjob task."),
          index: tool.schema
            .number()
            .optional()
            .describe("Optional insertion index among pending todos. Use 0 to make these the next pending todos."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/add-current", authSessionID, {
            items: args.items,
            index: args.index,
          }))
        },
      }),
      finishCurrentCronjobTodo: tool({
        description:
          "Mark the current TeamCopilot cronjob todo item complete. Use this only after the current todo item is fully done, then stop and wait for TeamCopilot to give you the next todo.",
        args: {
          summary: tool.schema
            .string()
            .describe("Concise evidence summary for what was completed for the current todo item."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const summary = args.summary?.trim()
          if (!summary) {
            throw new Error("summary is required")
          }
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/finish-current", authSessionID, {
            summary,
          }))
        },
      }),
    },
  }
}

export default ManageCronjobTodosPlugin

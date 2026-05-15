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

async function getJson(path: string, authSessionID: string): Promise<unknown> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${authSessionID}`,
    },
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
      addCronjobTodos: tool({
        description:
          "Add new todo items to the active TeamCopilot cronjob todo list. You must always pass an index. Example: if the active list is [A, B, C], then addCronjobTodos({ items: [\"X\", \"Y\"], index: 1 }) produces [A, X, Y, B, C]. If you want to insert at the start of the list, use index 0. If you want to append to the end of the active list, pass index equal to the length of the current active todo list. If you pass an index that is greater than the current active todo list's length, the tool fails and returns the current todo list so you can pick a valid insertion point. To make sure that you use the right index, always call getCronjobTodos right before calling this tool.",
        args: {
          items: tool.schema
            .array(tool.schema.string())
            .describe("New todo items required to complete the cronjob task."),
          index: tool.schema
            .number()
            .describe("Required insertion index in the active todo list."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/add", authSessionID, {
            items: args.items,
            index: args.index,
          }))
        },
      }),
      clearCronjobTodos: tool({
        description:
          "Remove one or more todos from the active TeamCopilot cronjob todo list. Provide todo_ids only. Todo ids are the stable references returned by the todo tools.",
        args: {
          todo_ids: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Todo ids to remove from the active list."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/clear", authSessionID, args))
        },
      }),
      getCurrentCronjobTodo: tool({
        description:
          "Get the current TeamCopilot cronjob todo item, if one is active.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const response = await getJson("/api/cronjobs/runs/todos/not-completed", authSessionID) as { todos?: Array<{ status?: string }> }
          const currentTodo = response.todos?.find((todo) => todo.status === "in_progress") ?? null
          return JSON.stringify({ todo: currentTodo })
        },
      }),
      getCronjobTodos: tool({
        description:
          "Get all active TeamCopilot cronjob todos that are not completed yet, including the current todo and any pending todos.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          return JSON.stringify(await getJson("/api/cronjobs/runs/todos/not-completed", authSessionID))
        },
      }),
      finishCurrentCronjobTodo: tool({
        description:
          "Mark the current TeamCopilot cronjob todo item complete. Use this only after the current todo item is fully done, then stop and wait for TeamCopilot to give you the next todo.",
        args: {
          completionSummary: tool.schema
            .string()
            .describe("Concise completion summary for what was completed for the current todo item."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const completionSummary = args.completionSummary?.trim()
          if (!completionSummary) {
            throw new Error("completionSummary is required")
          }
          return JSON.stringify(await postJson("/api/cronjobs/runs/todos/finish-current", authSessionID, {
            completionSummary,
          }))
        },
      }),
    },
  }
}

export default ManageCronjobTodosPlugin

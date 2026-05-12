import { type Plugin, tool } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}

interface PermissionResponse {
  approved: boolean
  status: string
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

function extractMessageId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null
  }

  const candidate = (context as { messageID?: unknown; messageId?: unknown; message_id?: unknown })
  const raw = candidate.messageID ?? candidate.messageId ?? candidate.message_id
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw)
  }
  return null
}

function extractCallId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null
  }

  const candidate = (context as { callID?: unknown; callId?: unknown; call_id?: unknown })
  const raw = candidate.callID ?? candidate.callId ?? candidate.call_id
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw
  }
  return null
}

function assertTargetType(targetType: string): void {
  if (targetType !== "prompt" && targetType !== "workflow") {
    throw new Error('target_type must be "prompt" or "workflow".')
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }
}

function ensureMessageAndCallIds(context: unknown): { messageId: string; callId: string } {
  const messageId = extractMessageId(context)
  const callId = extractCallId(context)

  if (!messageId) {
    throw new Error("Could not determine message id from tool context.")
  }

  if (!callId) {
    throw new Error("Could not determine call id from tool context.")
  }

  return { messageId, callId }
}

async function rejectCronjobPermission(
  sessionID: string,
  permissionId: string
): Promise<void> {
  await fetch(`${getApiBaseUrl()}/api/workflows/permission-reject/${permissionId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionID}`,
    },
  })
}

async function requestCronjobPermission(
  sessionID: string,
  messageID: string,
  callID: string,
  action: string
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/workflows/request-permission`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionID}`,
    },
    body: JSON.stringify({
      message_id: messageID,
      call_id: callID,
    }),
  })

  if (!response.ok) {
    const message = await readErrorMessageFromResponse(
      response,
      `Failed to request permission (HTTP ${response.status})`
    )
    throw new Error(message)
  }

  const data = (await response.json()) as { permission_id: string }
  const permissionId = data.permission_id

  const maxAttempts = 300
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const statusResponse = await fetch(
      `${getApiBaseUrl()}/api/workflows/permission-status/${permissionId}`,
      {
        headers: {
          Authorization: `Bearer ${sessionID}`,
        },
      }
    )

    if (!statusResponse.ok) {
      continue
    }

    const statusData = (await statusResponse.json()) as PermissionResponse

    if (statusData.status === "approved") {
      return
    }
    if (statusData.status === "rejected") {
      throw new Error(`User denied permission to ${action}.`)
    }
  }

  try {
    await rejectCronjobPermission(sessionID, permissionId)
  } catch {
    // Best-effort cleanup only; preserve the timeout error below.
  }
  throw new Error("Permission request timed out")
}

async function fetchJsonWithError(
  url: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const errorMessage = await readErrorMessageFromResponse(response, fallbackMessage)
    throw new Error(errorMessage)
  }
  return await response.json()
}

export const ManageCronjobsPlugin: Plugin = async ({ client }) => {
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
      listCronjobs: tool({
        description:
          "List the current user's TeamCopilot cronjobs, including ids needed for editCronjob and runCronjobNow. This is read-only and does not require approval.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)

          const payload = await fetchJsonWithError(
            `${getApiBaseUrl()}/api/cronjobs`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${authSessionID}`,
              },
            },
            "Failed to list cronjobs"
          )

          return JSON.stringify(payload, null, 2)
        },
      }),
      createCronjob: tool({
        description:
          "Create and schedule a TeamCopilot cronjob. Requires user approval for this tool call. Future scheduled runs of the created cronjob will not ask for approval again.",
        args: {
          name: tool.schema.string().describe("Human-readable cronjob name."),
          enabled: tool.schema.boolean().describe("Whether the cronjob should be scheduled immediately after creation."),
          target_type: tool.schema.enum(["prompt", "workflow"]).describe("Use prompt for an agent prompt cronjob, or workflow for a direct workflow cronjob."),
          prompt: tool.schema.string().optional().describe("Required when target_type is prompt. The unattended cronjob prompt to run."),
          allow_workflow_runs_without_permission: tool.schema.boolean().optional().default(true).describe("Prompt cronjobs only. If true, workflows invoked by that cronjob run without additional user approval during scheduled execution."),
          workflow_slug: tool.schema.string().optional().describe("Required when target_type is workflow. Workflow slug to run."),
          workflow_inputs: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().default({}).describe("Workflow cronjobs only. Saved workflow input arguments."),
          cron_expression: tool.schema.string().describe("Five-field cron expression, for example '0 9 * * 1-5'."),
          timezone: tool.schema.string().describe("IANA timezone, for example 'UTC', 'Asia/Kolkata', or 'America/Los_Angeles'."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const { messageId, callId } = ensureMessageAndCallIds(context)

          assertNonEmpty(args.name, "name")
          assertTargetType(args.target_type)
          assertNonEmpty(args.cron_expression, "cron_expression")
          assertNonEmpty(args.timezone, "timezone")
          if (args.target_type === "prompt") {
            assertNonEmpty(args.prompt ?? "", "prompt")
          }
          if (args.target_type === "workflow") {
            assertNonEmpty(args.workflow_slug ?? "", "workflow_slug")
          }

          await requestCronjobPermission(authSessionID, messageId, callId, "create this cronjob")

          const payload = await fetchJsonWithError(
            `${getApiBaseUrl()}/api/cronjobs`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authSessionID}`,
              },
              body: JSON.stringify(args),
            },
            "Failed to create cronjob"
          )

          return JSON.stringify(payload, null, 2)
        },
      }),
      editCronjob: tool({
        description:
          "Edit an existing TeamCopilot cronjob. Requires user approval for this tool call. Future scheduled runs of the edited cronjob will not ask for approval again.",
        args: {
          id: tool.schema.string().describe("Cronjob id to edit."),
          name: tool.schema.string().optional().describe("New human-readable cronjob name."),
          enabled: tool.schema.boolean().optional().describe("Whether the cronjob should be scheduled."),
          target_type: tool.schema.enum(["prompt", "workflow"]).optional().describe("Use prompt for an agent prompt cronjob, or workflow for a direct workflow cronjob."),
          prompt: tool.schema.string().optional().describe("Prompt cronjob task text."),
          allow_workflow_runs_without_permission: tool.schema.boolean().optional().describe("Prompt cronjobs only. If true, workflows invoked by that cronjob run without additional user approval during scheduled execution."),
          workflow_slug: tool.schema.string().optional().describe("Workflow slug for workflow cronjobs."),
          workflow_inputs: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Saved workflow input arguments."),
          cron_expression: tool.schema.string().optional().describe("Five-field cron expression, for example '0 9 * * 1-5'."),
          timezone: tool.schema.string().optional().describe("IANA timezone, for example 'UTC', 'Asia/Kolkata', or 'America/Los_Angeles'."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const { messageId, callId } = ensureMessageAndCallIds(context)

          assertNonEmpty(args.id, "id")
          if (args.target_type !== undefined) {
            assertTargetType(args.target_type)
          }
          if (args.name !== undefined) {
            assertNonEmpty(args.name, "name")
          }
          if (args.cron_expression !== undefined) {
            assertNonEmpty(args.cron_expression, "cron_expression")
          }
          if (args.timezone !== undefined) {
            assertNonEmpty(args.timezone, "timezone")
          }

          const { id, ...patch } = args
          if (Object.keys(patch).length === 0) {
            throw new Error("At least one cronjob field must be provided to edit.")
          }

          await requestCronjobPermission(authSessionID, messageId, callId, "edit this cronjob")

          const payload = await fetchJsonWithError(
            `${getApiBaseUrl()}/api/cronjobs/${encodeURIComponent(id)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authSessionID}`,
              },
              body: JSON.stringify(patch),
            },
            "Failed to edit cronjob"
          )

          return JSON.stringify(payload, null, 2)
        },
      }),
      runCronjobNow: tool({
        description:
          "Run an existing TeamCopilot cronjob immediately. Requires user approval for this tool call.",
        args: {
          id: tool.schema.string().describe("Cronjob id to run now."),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const { messageId, callId } = ensureMessageAndCallIds(context)

          assertNonEmpty(args.id, "id")

          await requestCronjobPermission(authSessionID, messageId, callId, "run this cronjob now")

          const payload = await fetchJsonWithError(
            `${getApiBaseUrl()}/api/cronjobs/${encodeURIComponent(args.id)}/run-now`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${authSessionID}`,
              },
            },
            "Failed to run cronjob now"
          )

          return JSON.stringify(payload, null, 2)
        },
      }),
    },
  }
}

export default ManageCronjobsPlugin

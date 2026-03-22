import { type Plugin, tool } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface SessionLookupResponse {
  error?: unknown
  data?: {
    id?: string
    parentID?: string
  }
}

export const RunWorkflowPlugin: Plugin = async ({ client }) => {
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
      runWorkflow: tool({
        description:
          "Execute a workflow with the provided inputs. Validates inputs against the workflow's schema defined in workflow.json, runs the workflow's venv Python with run.py and appropriate arguments, streams output in real-time, and enforces the timeout defined in workflow.json.",
        args: {
          slug: tool.schema
            .string()
            .describe(
              "The workflow slug (folder name under workflows/)"
            ),
          inputs: tool.schema
            .record(tool.schema.string(), tool.schema.unknown())
            .optional()
            .default({})
            .describe(
              "Key-value pairs matching the workflow's input schema from workflow.json"
            ),
        },
        async execute(args, context) {
          const { sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const { slug, inputs = {} } = args
          const messageId = extractMessageId(context)
          const callId = extractCallId(context)

          if (!messageId) {
            throw new Error("Could not determine message id from tool context.")
          }

          if (!callId) {
            throw new Error("Could not determine call id from tool context.")
          }

          const startResponse = await fetch(`${getApiBaseUrl()}/api/workflows/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSessionID}`,
            },
            body: JSON.stringify({
              slug,
              inputs,
              message_id: messageId,
              call_id: callId,
            }),
          })

          if (!startResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              startResponse,
              `Failed to execute workflow (HTTP ${startResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const startedPayload = (await startResponse.json()) as {
            execution_id?: unknown
          }
          const executionId = startedPayload.execution_id
          if (typeof executionId !== "string" || executionId.trim().length === 0) {
            throw new Error("Workflow execute start response did not include execution_id.")
          }

          while (true) {
            const resultResponse = await fetch(
              `${getApiBaseUrl()}/api/workflows/execute/${encodeURIComponent(executionId)}`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${authSessionID}`,
                },
              }
            )

            if (!resultResponse.ok) {
              const errorMessage = await readErrorMessageFromResponse(
                resultResponse,
                `Failed to fetch workflow execution result (HTTP ${resultResponse.status})`
              )
              throw new Error(errorMessage)
            }

            const resultPayload = (await resultResponse.json()) as {
              status?: unknown
            }
            if (resultPayload.status === "running") {
              await sleep(500)
              continue
            }
            if (resultPayload.status !== "success") {
              throw new Error(JSON.stringify(resultPayload))
            }
            return JSON.stringify(resultPayload)
          }
        },
      }),
    },
  }
}

export default RunWorkflowPlugin

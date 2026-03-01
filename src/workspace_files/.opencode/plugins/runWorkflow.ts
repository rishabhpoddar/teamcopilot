import { type Plugin, tool } from "@opencode-ai/plugin"

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

export const RunWorkflowPlugin: Plugin = async (_ctx) => {
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
          const { slug, inputs = {} } = args
          const messageId = extractMessageId(context)
          const callId = extractCallId(context)

          if (!messageId) {
            throw new Error("Could not determine message id from tool context.")
          }

          if (!callId) {
            throw new Error("Could not determine call id from tool context.")
          }

          const response = await fetch("http://localhost:3000/api/workflows/execute", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionID}`,
            },
            body: JSON.stringify({
              slug,
              inputs,
              message_id: messageId,
              call_id: callId,
            }),
          })

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to execute workflow (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = await response.json()
          return JSON.stringify(payload)
        },
      }),
    },
  }
}

export default RunWorkflowPlugin

import { type Plugin, tool } from "@opencode-ai/plugin"
import {
  startWorkflowRun,
  type StartWorkflowRunOptions,
} from "./workflowRunnerShared"

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

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (!value || typeof value !== "object") return false
  const candidate = value as {
    aborted?: unknown
    addEventListener?: unknown
    removeEventListener?: unknown
  }
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  )
}

function extractAbortSignal(context: unknown): AbortSignal | null {
  if (!context || typeof context !== "object") return null
  const candidate = context as {
    signal?: unknown
    abortSignal?: unknown
    abort_signal?: unknown
  }

  if (isAbortSignalLike(candidate.signal)) return candidate.signal
  if (isAbortSignalLike(candidate.abortSignal)) return candidate.abortSignal
  if (isAbortSignalLike(candidate.abort_signal)) return candidate.abort_signal
  return null
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
          const { directory, sessionID } = context
          const { slug, inputs = {} } = args
          const messageId = extractMessageId(context)
          const callId = extractCallId(context)
          const abortSignal = extractAbortSignal(context)

          if (!messageId) {
            throw new Error("Could not determine message id from tool context.")
          }

          if (!callId) {
            throw new Error("Could not determine call id from tool context.")
          }

          const run = await startWorkflowRun({
            directory,
            sessionID,
            messageID: messageId,
            callID: callId,
            authToken: sessionID,
            slug,
            inputs: inputs as Record<string, unknown>,
            requestPermission: true,
            abortSignal,
            enableCancellationPolling: true,
          } satisfies StartWorkflowRunOptions)

          const result = await run.completion
          const warningFields: Record<string, unknown> = result.warning
            ? {
              warning: "run_status_update_failed",
              warning_message: result.warning,
            }
            : {}

          const finalOutput = JSON.stringify({
            status: result.status,
            output: result.output,
            workflow: slug,
            timeout_seconds: run.timeoutSeconds,
            run_id: run.runId,
            ...warningFields,
          })

          if (result.status !== "success") {
            throw new Error("Workflow execution failed: " + finalOutput)
          }

          return finalOutput
        },
      }),
    },
  }
}

export default RunWorkflowPlugin

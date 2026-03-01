import { type Plugin, tool } from "@opencode-ai/plugin"
import * as fs from "fs/promises"
import * as path from "path"

// ============================================================================
// Types
// ============================================================================

interface WorkflowInput {
  type: "string" | "number" | "boolean"
  required?: boolean
  default?: string | number | boolean
  description?: string
}

interface WorkflowManifest {
  intent_summary: string
  inputs?: Record<string, WorkflowInput>
  triggers?: {
    manual?: boolean
  }
  runtime?: {
    timeout_seconds?: number
  }
}

interface PermissionResponse {
  approved: boolean
}

// ============================================================================
// Constants
// ============================================================================

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const API_BASE_URL = "http://localhost:3000"

// ============================================================================
// Helper Functions
// ============================================================================

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false;
  }
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const parent = path.resolve(parentPath) + path.sep
  const child = path.resolve(childPath) + path.sep
  return child.startsWith(parent)
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
      // Non-JSON body, fall back to plain text below.
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

async function rejectWorkflowPermission(
  sessionID: string,
  permissionId: string
): Promise<void> {
  await fetch(`${API_BASE_URL}/api/workflows/permission-reject/${permissionId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionID}`,
    },
  })
}

async function requestWorkflowPermission(
  sessionID: string,
  messageID: string,
  callID: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/workflows/request-permission`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionID}`,
    },
    body: JSON.stringify({
      opencode_session_id: sessionID,
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
      `${API_BASE_URL}/api/workflows/permission-status/${permissionId}`,
      {
        headers: {
          Authorization: `Bearer ${sessionID}`,
        },
      }
    )

    if (!statusResponse.ok) {
      continue
    }

    const statusData = (await statusResponse.json()) as PermissionResponse & {
      status: string
    }

    if (statusData.status === "approved") {
      return
    }
    if (statusData.status === "rejected") {
      throw new Error("User denied permission to create this workflow.")
    }
  }

  try {
    await rejectWorkflowPermission(sessionID, permissionId)
  } catch {
    // Best-effort cleanup only; preserve the timeout error below.
  }
  throw new Error("Permission request timed out")
}

// ============================================================================
// Plugin
// ============================================================================

export const CreateWorkflowPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      createWorkflow: tool({
        description:
          "Create a new workflow with the specified slug and configuration. Creates the workflow folder with all required files (workflow.json, run.py, requirements.txt, etc.). The workflow will need admin approval before it can be executed.",
        args: {
          slug: tool.schema
            .string()
            .describe(
              "The workflow slug (lowercase letters/numbers with hyphens, e.g., 'failed-stripe-payments')"
            ),
          intent_summary: tool.schema
            .string()
            .describe(
              "Human-readable description of what this workflow does"
            ),
          inputs: tool.schema
            .record(
              tool.schema.string(),
              tool.schema.object({
                type: tool.schema.enum(["string", "number", "boolean"]),
                required: tool.schema.boolean().optional(),
                default: tool.schema.unknown().optional(),
                description: tool.schema.string().optional(),
              })
            )
            .optional()
            .default({})
            .describe(
              "Input parameter schema defining the workflow's expected inputs"
            ),
          timeout_seconds: tool.schema
            .number()
            .optional()
            .default(300)
            .describe(
              "Maximum execution time in seconds (1-86400, default: 300)"
            ),
        },
        async execute(args, context) {
          const { directory, sessionID } = context
          const { slug, intent_summary, inputs = {}, timeout_seconds = 300 } = args
          const messageId = extractMessageId(context)
          const callId = extractCallId(context)

          if (!messageId) {
            throw new Error("Could not determine message id from tool context.")
          }

          if (!callId) {
            throw new Error("Could not determine call id from tool context.")
          }

          // Validate slug format
          if (!SLUG_REGEX.test(slug)) {
            throw new Error(
              `Invalid slug format: "${slug}". Slug must be lowercase, alphanumeric with hyphens (e.g., "my-workflow-name").`
            )
          }

          // Validate timeout
          if (timeout_seconds < 1 || timeout_seconds > 86400) {
            throw new Error(
              `Invalid timeout: ${timeout_seconds}. Must be between 1 and 86400 seconds.`
            )
          }

          // Path traversal protection
          const workflowsDir = path.join(directory, "workflows")
          const workflowDir = path.join(workflowsDir, slug)

          if (!isPathInside(workflowDir, workflowsDir)) {
            throw new Error("Path traversal detected. Invalid slug.")
          }

          // Check if workflow already exists
          if (await pathExists(workflowDir)) {
            throw new Error(`Workflow "${slug}" already exists at ${workflowDir}`)
          }

          // Request permission after basic validation and existence checks pass.
          await requestWorkflowPermission(
            sessionID,
            messageId,
            callId
          )

          // Ensure workflows directory exists
          await fs.mkdir(workflowsDir, { recursive: true })

          // Create workflow directory
          await fs.mkdir(workflowDir, { recursive: true })

          // Create workflow.json
          const workflowJson: WorkflowManifest = {
            intent_summary,
            inputs: inputs as Record<string, WorkflowInput>,
            triggers: { manual: true },
            runtime: { timeout_seconds },
          }
          await fs.writeFile(
            path.join(workflowDir, "workflow.json"),
            JSON.stringify(workflowJson, null, 2),
            "utf-8"
          )

          // Create empty files
          await fs.writeFile(path.join(workflowDir, "run.py"), "", "utf-8")
          await fs.writeFile(path.join(workflowDir, "requirements.txt"), "", "utf-8")
          await fs.writeFile(path.join(workflowDir, "requirements.lock.txt"), "", "utf-8")
          await fs.writeFile(path.join(workflowDir, ".env"), "", "utf-8")
          await fs.writeFile(path.join(workflowDir, ".env.example"), "", "utf-8")
          await fs.writeFile(path.join(workflowDir, "README.md"), "", "utf-8")

          const creatorResponse = await fetch(
            `${API_BASE_URL}/api/workflows/${encodeURIComponent(slug)}/creator`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionID}`,
              },
            }
          )

          if (!creatorResponse.ok) {
            const message = await readErrorMessageFromResponse(
              creatorResponse,
              `Failed to set workflow creator (HTTP ${creatorResponse.status})`
            )
            throw new Error(
              `Workflow "${slug}" was created, but saving creator metadata failed: ${message}`
            )
          }

          return JSON.stringify({
            success: true,
            message: `Workflow "${slug}" created successfully. Remember: this workflow needs admin approval before it can be executed.`,
            workflow_path: path.relative(directory, workflowDir),
          })
        },
      }),
    },
  }
}

export default CreateWorkflowPlugin

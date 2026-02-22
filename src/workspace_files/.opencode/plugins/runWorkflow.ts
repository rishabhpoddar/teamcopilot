import { type Plugin, tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import { createWriteStream } from "fs"
import * as fsp from "fs/promises"
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

interface WorkflowJson {
  intent_summary?: string
  inputs?: Record<string, WorkflowInput>
  triggers?: Record<string, unknown>
  runtime?: {
    timeout_seconds?: number
  }
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  processedInputs: Record<string, string | number | boolean>
}

type RunStatus = "success" | "error" | "timeout" | "aborted"

// ============================================================================
// Constants
// ============================================================================

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_OUTPUT_CHARS = 300_000
const API_BASE_URL = "http://localhost:3000"
const OPENCODE_PORT = Number.parseInt(process.env.OPENCODE_PORT ?? "4096", 10)
const OPENCODE_BASE_URL = `http://localhost:${Number.isFinite(OPENCODE_PORT) ? OPENCODE_PORT : 4096}`

// ============================================================================
// API Functions
// ============================================================================

interface WorkflowRunResponse {
  run: {
    id: string
    workflow_slug: string
    status: string
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string }

function isApiError<T>(
  result: ApiResult<T>
): result is { ok: false; message: string } {
  return result.ok === false
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
      // non-JSON error body, fall through to returning text (if useful)
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

/**
 * Creates a new workflow run entry in the database.
 */
async function createWorkflowRun(
  slug: string,
  args: Record<string, unknown>,
  sessionID: string
): Promise<ApiResult<string>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/workflows/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionID}`,
      },
      body: JSON.stringify({
        workflow_slug: slug,
        args,
      }),
    })

    if (!response.ok) {
      const message = await readErrorMessageFromResponse(
        response,
        `Failed to create run entry (HTTP ${response.status})`
      )
      return { ok: false, message }
    }

    const data = (await response.json()) as WorkflowRunResponse
    return { ok: true, data: data.run.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
}

/**
 * Updates the status of a workflow run in the database.
 */
async function updateWorkflowRunStatus(
  runId: string,
  status: "running" | "success" | "failed",
  sessionID: string,
  errorMessage?: string,
  output?: string
): Promise<ApiResult<true>> {
  try {
    const body: { status: string; error_message?: string; output?: string } = { status }
    if (errorMessage) {
      body.error_message = errorMessage
    }
    if (output) {
      body.output = output
    }

    const response = await fetch(`${API_BASE_URL}/api/workflows/runs/${runId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionID}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const message = await readErrorMessageFromResponse(
        response,
        `Failed to update run status (HTTP ${response.status})`
      )
      return { ok: false, message }
    }

    return { ok: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
}

// ============================================================================
// Process cleanup coordination (avoid stacking global handlers per run)
// ============================================================================

type CleanupFn = (signal?: NodeJS.Signals) => void
const activeCleanups = new Set<CleanupFn>()
let globalCleanupHandlersInstalled = false

function installGlobalCleanupHandlersOnce(): void {
  if (globalCleanupHandlersInstalled) return
  globalCleanupHandlersInstalled = true

  const onParentExit = () => {
    for (const cleanup of Array.from(activeCleanups)) {
      cleanup("SIGKILL")
    }
  }

  const onParentSignal = () => {
    for (const cleanup of Array.from(activeCleanups)) {
      cleanup("SIGTERM")
    }
    setTimeout(() => {
      for (const cleanup of Array.from(activeCleanups)) {
        cleanup("SIGKILL")
      }
    }, 1000)
  }

  process.on("exit", onParentExit)
  process.on("SIGTERM", onParentSignal)
  process.on("SIGINT", onParentSignal)
  process.on("SIGHUP", onParentSignal)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads and parses workflow.json from a workflow directory.
 */
async function readWorkflowJson(
  workflowPath: string
): Promise<WorkflowJson> {
  const workflowJsonPath = path.join(workflowPath, "workflow.json")
  const content = await fsp.readFile(workflowJsonPath, "utf-8")
  return JSON.parse(content) as WorkflowJson
}

/**
 * Checks if the workflow's .venv exists.
 */
async function assertVenvExists(workflowPath: string): Promise<void> {
  const venvPath = path.join(workflowPath, ".venv")
  const stats = await fsp.stat(venvPath)
  if (!stats.isDirectory()) {
    throw new Error(`Virtual environment path is not a directory: ${venvPath}`)
  }
}

async function assertPathExists(p: string): Promise<void> {
  await fsp.access(p)
}

async function assertDirectory(p: string): Promise<void> {
  const stats = await fsp.stat(p)
  if (!stats.isDirectory()) {
    throw new Error(`Expected directory at ${p}`)
  }
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const parent = path.resolve(parentPath) + path.sep
  const child = path.resolve(childPath) + path.sep
  return child.startsWith(parent)
}

function getVenvPythonPath(workflowPath: string): string {
  return path.join(workflowPath, ".venv", "bin", "python")
}

function getVenvBinDir(workflowPath: string): string {
  return path.join(workflowPath, ".venv", "bin")
}

function parseTimeoutSeconds(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  if (raw <= 0) return null
  // avoid absurd values (still allow long workflows, but cap to 24h)
  return Math.min(Math.floor(raw), 24 * 60 * 60)
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  if (["true", "1", "yes", "y", "on"].includes(v)) return true
  if (["false", "0", "no", "n", "off"].includes(v)) return false
  return null
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Validates inputs against the workflow.json schema.
 */
function validateInputs(
  providedInputs: Record<string, unknown>,
  schema: Record<string, WorkflowInput>
): ValidationResult {
  const errors: string[] = []
  const processedInputs: Record<string, string | number | boolean> = {}

  // Check for required inputs
  for (const [name, config] of Object.entries(schema)) {
    const value = providedInputs[name]

    if (value === undefined || value === null) {
      if (config.required !== false && config.default === undefined) {
        errors.push(`Missing required input: '${name}'`)
        continue
      }
      // Use default value if available
      if (config.default !== undefined) {
        // Validate defaults too (misconfigured workflow.json should fail fast)
        const defaultValidation = validateInputs(
          { [name]: config.default },
          { [name]: { ...config, required: false } }
        )
        if (!defaultValidation.valid) {
          errors.push(
            `Invalid default for '${name}': ${defaultValidation.errors.join("; ")}`
          )
        } else {
          processedInputs[name] = defaultValidation.processedInputs[name]
        }
        continue
      }
      // Skip optional inputs with no default
      continue
    }

    // Type validation
    const expectedType = config.type
    let isValid = false
    let processedValue: string | number | boolean | null = null

    switch (expectedType) {
      case "string":
        if (typeof value === "string") {
          processedValue = value
          isValid = true
        } else if (
          typeof value === "number" ||
          typeof value === "boolean" ||
          typeof value === "bigint"
        ) {
          processedValue = String(value)
          isValid = true
        }
        break
      case "number":
        {
          const coerced = coerceNumber(value)
          if (coerced !== null) {
            processedValue = coerced
            isValid = true
          }
        }
        break
      case "boolean":
        {
          const coerced = coerceBoolean(value)
          if (coerced !== null) {
            processedValue = coerced
            isValid = true
          }
        }
        break
      default:
        // Unknown type, accept as-is
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          processedValue = value
          isValid = true
        } else {
          isValid = false
        }
    }

    if (!isValid) {
      errors.push(
        `Invalid type for '${name}': expected ${expectedType}, got ${typeof value}`
      )
    } else {
      processedInputs[name] = processedValue as string | number | boolean
    }
  }

  // Check for unexpected inputs
  for (const name of Object.keys(providedInputs)) {
    if (!(name in schema)) {
      errors.push(`Unexpected input: '${name}' is not defined in workflow.json`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    processedInputs,
  }
}

/**
 * Converts inputs to command-line arguments for the Python script.
 */
function inputsToArgs(
  inputs: Record<string, string | number | boolean>
): string[] {
  const args: string[] = []
  for (const [name, value] of Object.entries(inputs)) {
    const argName = `--${name}`
    if (typeof value === "boolean") {
      if (value) {
        args.push(argName)
      }
    } else {
      args.push(argName, String(value))
    }
  }
  return args
}

/**
 * Kills a process group safely.
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    // Kill the entire process group (negative PID)
    process.kill(-pid, signal)
  } catch {
    // Process may already be dead
  }
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_")
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

async function isMessageOrSessionAborted(
  sessionID: string,
  directory: string
): Promise<boolean> {
  const query = `directory=${encodeURIComponent(directory)}`

  // Single source of truth: session status endpoint.
  // If this session is not actively busy, stop the workflow process.
  const statusRes = await fetch(`${OPENCODE_BASE_URL}/session/status?${query}`)
  if (!statusRes.ok) {
    return false
  }
  const statuses = (await statusRes.json()) as Record<string, { type?: string }>
  const state = statuses[sessionID] ?? null
  const sessionType = typeof state?.type === "string" ? state.type : null

  // Important: status endpoint may drop the session key after abort/interrupt.
  // If the session is not actively busy anymore, this tool should stop.
  return sessionType !== "busy"
}

/**
 * Runs the workflow with timeout, piping stdout/stderr and streaming to output file.
 * Spawns in a new process group so the entire tree can be killed if needed.
 */
function runWithTimeout(
  workflowPath: string,
  args: string[],
  timeoutSeconds: number,
  outputFilePath: string,
  abortSignal: AbortSignal | null,
  cancellationProbe: {
    sessionID: string
    directory: string
  }
): Promise<{ status: RunStatus; output: string }> {
  return new Promise((resolve) => {
    installGlobalCleanupHandlersOnce()

    const venvPython = getVenvPythonPath(workflowPath)
    const runScript = path.join(workflowPath, "run.py")
    const venvBinDir = getVenvBinDir(workflowPath)

    let output = ""
    let resolved = false
    let outputTruncated = false
    const outputFileStream = createWriteStream(outputFilePath, {
      flags: "a",
      encoding: "utf-8",
    })
    let outputFileErrored = false

    outputFileStream.on("error", (err) => {
      if (outputFileErrored) return
      outputFileErrored = true
      process.stderr.write(`\n[WARN] Failed writing workflow output file: ${err.message}\n`)
    })

    const appendOutput = (text: string) => {
      if (resolved) return
      if (outputTruncated) return
      const remaining = MAX_OUTPUT_CHARS - output.length
      if (remaining <= 0) {
        outputTruncated = true
        output += `\n[WARN] Output truncated after ${MAX_OUTPUT_CHARS} characters\n`
        return
      }
      if (text.length <= remaining) {
        output += text
        return
      }
      output += text.slice(0, remaining)
      outputTruncated = true
      output += `\n[WARN] Output truncated after ${MAX_OUTPUT_CHARS} characters\n`
    }

    const appendFileOutput = (text: string) => {
      if (resolved || outputFileErrored) return
      outputFileStream.write(text)
    }

    // Spawn the process in a new process group (detached)
    // This allows us to kill the entire process tree
    const child = spawn(venvPython, ["-u", runScript, ...args], {
      cwd: workflowPath,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        VIRTUAL_ENV: path.join(workflowPath, ".venv"),
        PATH: [venvBinDir, process.env.PATH ?? ""]
          .filter(Boolean)
          .join(path.delimiter),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // Create new process group
    })

    const pid = child.pid

    // Cleanup function to kill the process group
    const cleanup = (signal: NodeJS.Signals = "SIGTERM") => {
      if (pid) {
        killProcessGroup(pid, signal)
      }
    }

    activeCleanups.add(cleanup)

    const removeStreamListeners = () => {
      child.stdout?.removeAllListeners("data")
      child.stderr?.removeAllListeners("data")
    }

    let timeoutId: NodeJS.Timeout | null = null
    let cancellationPollId: NodeJS.Timeout | null = null
    const abortWorkflow = () => {
      if (resolved) return
      cleanup("SIGTERM")
      setTimeout(() => cleanup("SIGKILL"), 1000)
      appendOutput("\n[ERROR] Workflow execution was aborted\n")
      appendFileOutput("\n[ERROR] Workflow execution was aborted\n")
      process.stderr.write("\n[ERROR] Workflow execution was aborted\n")
      safeResolve({ status: "aborted", output })
    }

    const safeResolve = (result: { status: RunStatus; output: string }) => {
      if (!resolved) {
        resolved = true
        activeCleanups.delete(cleanup)
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        abortSignal?.removeEventListener("abort", abortWorkflow)
        if (cancellationPollId) {
          clearInterval(cancellationPollId)
          cancellationPollId = null
        }
        removeStreamListeners()
        outputFileStream.end()
        resolve(result)
      }
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        abortWorkflow()
        return
      }
      abortSignal.addEventListener("abort", abortWorkflow, { once: true })
    }

    let pollInFlight = false
    cancellationPollId = setInterval(async () => {
      if (resolved || pollInFlight) return
      pollInFlight = true
      let aborted = false
      try {
        aborted = await isMessageOrSessionAborted(
          cancellationProbe.sessionID,
          cancellationProbe.directory
        )
      } catch {
        aborted = false
      } finally {
        pollInFlight = false
      }
      if (!aborted || resolved) return
      abortWorkflow()
    }, 500)

    // Pipe stdout
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      appendFileOutput(text)
      process.stdout.write(text)
    })

    // Pipe stderr
    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      appendFileOutput(text)
      process.stderr.write(text)
    })

    // Set up timeout
    timeoutId = setTimeout(() => {
      cleanup("SIGTERM")
      // Give it a moment to terminate gracefully
      setTimeout(() => cleanup("SIGKILL"), 1000)
      appendOutput(
        `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`
      )
      appendFileOutput(
        `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`
      )
      process.stderr.write(
        `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`
      )
      safeResolve({ status: "timeout", output })
    }, timeoutSeconds * 1000)

    // Handle process exit
    child.on("close", (code) => {
      if (code === 0) {
        safeResolve({ status: "success", output })
      } else if (code !== null) {
        appendOutput(`\n[ERROR] Process exited with code ${code}\n`)
        safeResolve({ status: "error", output })
      }
      // If code is null, timeout handler already resolved
    })

    child.on("error", (err) => {
      appendOutput(`\n[ERROR] Failed to start process: ${err.message}\n`)
      appendFileOutput(`\n[ERROR] Failed to start process: ${err.message}\n`)
      process.stderr.write(`\n[ERROR] Failed to start process: ${err.message}\n`)
      safeResolve({ status: "error", output })
    })
  })
}

// ============================================================================
// Permission Request Function
// ============================================================================

interface PermissionResponse {
  approved: boolean
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

/**
 * Requests permission from user to run a workflow.
 * Creates a permission request and waits for user response.
 */
async function requestWorkflowPermission(
  sessionID: string,
  messageID: string,
  callID: string
): Promise<void> {
  // Create permission request via backend API
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

  // Poll for permission response (max 5 minutes)
  const maxAttempts = 300 // 5 minutes with 1s intervals
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
      throw new Error("User denied permission to run this workflow.")
    }
    // If status is still "pending", continue polling
  }

  // Timeout - permission not granted in time
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

          if (!SLUG_REGEX.test(slug)) {
            throw new Error(
              "Invalid workflow slug. Expected lowercase letters/numbers with optional hyphens (e.g. 'failed-stripe-payments')."
            )
          }

          const workflowsRoot = path.join(directory, "workflows")
          const workflowPath = path.join(workflowsRoot, slug)

          if (!isPathInside(workflowPath, workflowsRoot)) {
            throw new Error("Invalid workflow path (must be inside workflows/).")
          }

          // Check if workflow exists (and is a directory)
          await assertDirectory(workflowPath)

          // Validate required files exist early for clearer errors
          const runScript = path.join(workflowPath, "run.py")
          await assertPathExists(runScript)

          // Request permission after basic workflow existence checks pass.
          await requestWorkflowPermission(
            sessionID,
            messageId,
            callId
          )

          // Read workflow.json
          const workflowJson = await readWorkflowJson(workflowPath)

          // Check if .venv exists
          await assertVenvExists(workflowPath)

          // Check venv python exists (more specific than just .venv/)
          const venvPython = getVenvPythonPath(workflowPath)
          await assertPathExists(venvPython)

          // Validate inputs against schema
          const inputSchema = workflowJson.inputs || {}
          const validation = validateInputs(
            inputs as Record<string, unknown>,
            inputSchema
          )

          if (!validation.valid) {
            throw new Error(
              `Input validation failed: ${JSON.stringify(validation.errors)}`
            )
          }

          // Get timeout from workflow.json (default to 60 seconds).
          const timeoutSeconds =
            parseTimeoutSeconds(workflowJson.runtime?.timeout_seconds)

          if (!timeoutSeconds) {
            throw new Error(
              `Could not read runtime.timeout_seconds from workflow.json for '${slug}'`
            )
          }

          // Convert inputs to command-line arguments
          const cmdArgs = inputsToArgs(validation.processedInputs)

          // Create a run entry in the database (this also checks approval status)
          const runCreate = await createWorkflowRun(
            slug,
            inputs as Record<string, unknown>,
            sessionID
          )
          if (isApiError(runCreate)) {
            throw new Error(runCreate.message)
          }

          const runId = runCreate.data
          const workflowRunsDir = path.join(directory, "workflow-runs")
          await fsp.mkdir(workflowRunsDir, { recursive: true })
          const outputFilePath = path.join(
            workflowRunsDir,
            `${sanitizeFilenamePart(sessionID)}-${sanitizeFilenamePart(messageId)}.txt`
          )
          await fsp.writeFile(outputFilePath, "", "utf-8")

          // Run the workflow
          const result = await runWithTimeout(
            workflowPath,
            cmdArgs,
            timeoutSeconds,
            outputFilePath,
            abortSignal,
            {
              sessionID,
              directory,
            }
          )

          // Update the run status in the database
          const dbStatus = result.status === "success" ? "success" : "failed"
          const errorMessage = result.status !== "success" ? result.output.slice(-1000) : undefined
          const runUpdate = await updateWorkflowRunStatus(
            runId,
            dbStatus,
            sessionID,
            errorMessage,
            result.output
          )

          const warningFields: Record<string, unknown> = isApiError(runUpdate)
            ? {
              warning: "run_status_update_failed",
              warning_message: runUpdate.message,
            }
            : {}

          const finalOutput = JSON.stringify({
            status: result.status,
            output: result.output,
            workflow: slug,
            timeout_seconds: timeoutSeconds,
            run_id: runId,
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

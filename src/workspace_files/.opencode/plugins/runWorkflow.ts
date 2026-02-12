import { type Plugin, tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"

// ============================================================================
// Types
// ============================================================================

interface WorkflowInput {
  type: "string" | "number" | "boolean" | "integer"
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

type RunStatus = "success" | "error" | "timeout"

// ============================================================================
// Constants
// ============================================================================

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_OUTPUT_CHARS = 300_000
const API_BASE_URL = "http://localhost:3000"

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
  args: Record<string, unknown>
): Promise<ApiResult<string>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/workflows/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
): Promise<WorkflowJson | null> {
  const workflowJsonPath = path.join(workflowPath, "workflow.json")
  try {
    const content = await fs.readFile(workflowJsonPath, "utf-8")
    return JSON.parse(content) as WorkflowJson
  } catch {
    return null
  }
}

/**
 * Checks if the workflow's .venv exists.
 */
async function venvExists(workflowPath: string): Promise<boolean> {
  const venvPath = path.join(workflowPath, ".venv")
  try {
    const stats = await fs.stat(venvPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stats = await fs.stat(p)
    return stats.isDirectory()
  } catch {
    return false
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

function coerceInteger(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value)
  )
    return value
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^[+-]?\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isInteger(n) && Number.isFinite(n) ? n : null
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
      case "integer":
        {
          const coerced = coerceInteger(value)
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

/**
 * Runs the workflow with timeout, piping stdout/stderr.
 * Spawns in a new process group so the entire tree can be killed if needed.
 */
function runWithTimeout(
  workflowPath: string,
  args: string[],
  timeoutSeconds: number
): Promise<{ status: RunStatus; output: string }> {
  return new Promise((resolve) => {
    installGlobalCleanupHandlersOnce()

    const venvPython = getVenvPythonPath(workflowPath)
    const runScript = path.join(workflowPath, "run.py")
    const venvBinDir = getVenvBinDir(workflowPath)

    let output = ""
    let resolved = false
    let outputTruncated = false

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

    // Spawn the process in a new process group (detached)
    // This allows us to kill the entire process tree
    const child = spawn(venvPython, [runScript, ...args], {
      cwd: workflowPath,
      env: {
        ...process.env,
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

    const safeResolve = (result: { status: RunStatus; output: string }) => {
      if (!resolved) {
        resolved = true
        activeCleanups.delete(cleanup)
        removeStreamListeners()
        resolve(result)
      }
    }

    // Pipe stdout
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      process.stdout.write(text)
    })

    // Pipe stderr
    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      process.stderr.write(text)
    })

    // Set up timeout
    const timeoutId = setTimeout(() => {
      cleanup("SIGTERM")
      // Give it a moment to terminate gracefully
      setTimeout(() => cleanup("SIGKILL"), 1000)
      appendOutput(
        `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`
      )
      process.stderr.write(
        `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`
      )
      safeResolve({ status: "timeout", output })
    }, timeoutSeconds * 1000)

    // Handle process exit
    child.on("close", (code) => {
      clearTimeout(timeoutId)
      if (code === 0) {
        safeResolve({ status: "success", output })
      } else if (code !== null) {
        appendOutput(`\n[ERROR] Process exited with code ${code}\n`)
        safeResolve({ status: "error", output })
      }
      // If code is null, timeout handler already resolved
    })

    child.on("error", (err) => {
      clearTimeout(timeoutId)
      appendOutput(`\n[ERROR] Failed to start process: ${err.message}\n`)
      process.stderr.write(`\n[ERROR] Failed to start process: ${err.message}\n`)
      safeResolve({ status: "error", output })
    })
  })
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
          const { directory } = context
          const { slug, inputs = {} } = args

          if (!SLUG_REGEX.test(slug)) {
            return JSON.stringify({
              status: "error",
              error: "invalid_slug",
              message:
                "Invalid workflow slug. Expected lowercase letters/numbers with optional hyphens (e.g. 'failed-stripe-payments').",
            })
          }

          const workflowsRoot = path.join(directory, "workflows")
          const workflowPath = path.join(workflowsRoot, slug)

          if (!isPathInside(workflowPath, workflowsRoot)) {
            return JSON.stringify({
              status: "error",
              error: "invalid_slug",
              message: "Invalid workflow path (must be inside workflows/).",
            })
          }

          // Check if workflow exists (and is a directory)
          if (!(await isDirectory(workflowPath))) {
            return JSON.stringify({
              status: "error",
              error: "workflow_not_found",
              message: `Workflow '${slug}' not found at ${workflowPath}`,
            })
          }

          // Validate required files exist early for clearer errors
          const runScript = path.join(workflowPath, "run.py")
          if (!(await pathExists(runScript))) {
            return JSON.stringify({
              status: "error",
              error: "invalid_workflow",
              message: `Missing required file 'run.py' for workflow '${slug}'`,
            })
          }

          // Read workflow.json
          const workflowJson = await readWorkflowJson(workflowPath)
          if (!workflowJson) {
            return JSON.stringify({
              status: "error",
              error: "invalid_workflow",
              message: `Could not read workflow.json for '${slug}'`,
            })
          }

          // Check if .venv exists
          if (!(await venvExists(workflowPath))) {
            return JSON.stringify({
              status: "error",
              error: "venv_not_found",
              message: `Virtual environment (.venv) not found for workflow '${slug}'. Please create it first.`,
            })
          }

          // Check venv python exists (more specific than just .venv/)
          const venvPython = getVenvPythonPath(workflowPath)
          if (!(await pathExists(venvPython))) {
            return JSON.stringify({
              status: "error",
              error: "venv_python_not_found",
              message: `Virtual environment python not found at ${venvPython}`,
            })
          }

          // Validate inputs against schema
          const inputSchema = workflowJson.inputs || {}
          const validation = validateInputs(
            inputs as Record<string, unknown>,
            inputSchema
          )

          if (!validation.valid) {
            return JSON.stringify({
              status: "error",
              error: "invalid_inputs",
              message: "Input validation failed",
              errors: validation.errors,
            })
          }

          // Get timeout from workflow.json (default to 60 seconds).
          const timeoutSeconds =
            parseTimeoutSeconds(workflowJson.runtime?.timeout_seconds)

          if (!timeoutSeconds) {
            return JSON.stringify({
              status: "error",
              error: "invalid_workflow",
              message: `Could not read runtime.timeout_seconds from workflow.json for '${slug}'`,
            })
          }

          // Convert inputs to command-line arguments
          const cmdArgs = inputsToArgs(validation.processedInputs)

          // Create a run entry in the database (this also checks approval status)
          const runCreate = await createWorkflowRun(
            slug,
            inputs as Record<string, unknown>
          )
          if (isApiError(runCreate)) {
            return JSON.stringify({
              status: "error",
              error: "run_creation_failed",
              message: runCreate.message,
            })
          }

          const runId = runCreate.data

          // Run the workflow
          const result = await runWithTimeout(
            workflowPath,
            cmdArgs,
            timeoutSeconds
          )

          // Update the run status in the database
          const dbStatus = result.status === "success" ? "success" : "failed"
          const errorMessage = result.status !== "success" ? result.output.slice(-1000) : undefined
          const runUpdate = await updateWorkflowRunStatus(
            runId,
            dbStatus,
            errorMessage,
            result.output
          )

          const warningFields: Record<string, unknown> = isApiError(runUpdate)
            ? {
              warning: "run_status_update_failed",
              warning_message: runUpdate.message,
            }
            : {}

          return JSON.stringify({
            status: result.status,
            output: result.output,
            workflow: slug,
            timeout_seconds: timeoutSeconds,
            run_id: runId,
            ...warningFields,
          })
        },
      }),
    },
  }
}

export default RunWorkflowPlugin

import { spawn } from "child_process"
import { createWriteStream } from "fs"
import * as fsp from "fs/promises"
import * as path from "path"

interface WorkflowInput {
  type: "string" | "number" | "boolean"
  required?: boolean
  default?: string | number | boolean
}

interface WorkflowJson {
  inputs?: Record<string, WorkflowInput>
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

const MAX_OUTPUT_CHARS = 300_000
const API_BASE_URL = "http://localhost:3000"
const OPENCODE_PORT = Number.parseInt(process.env.OPENCODE_PORT ?? "4096", 10)
const OPENCODE_BASE_URL = `http://localhost:${Number.isFinite(OPENCODE_PORT) ? OPENCODE_PORT : 4096}`
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface WorkflowRunResponse {
  run: {
    id: string
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string }

export interface StartWorkflowRunOptions {
  directory: string
  sessionID: string
  messageID: string
  callID: string
  authToken: string
  slug: string
  inputs: Record<string, unknown>
  requestPermission: boolean
  abortSignal: AbortSignal | null
  enableCancellationPolling: boolean
}

export interface WorkflowRunCompletionResult {
  status: RunStatus
  output: string
  warning: string | null
}

export interface StartedWorkflowRun {
  runId: string
  timeoutSeconds: number
  completion: Promise<WorkflowRunCompletionResult>
}

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

async function createWorkflowRun(
  slug: string,
  args: Record<string, unknown>,
  sessionID: string,
  messageID: string,
  authToken: string
): Promise<ApiResult<string>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/workflows/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workflow_slug: slug,
        session_id: sessionID,
        message_id: messageID,
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

async function updateWorkflowRunStatus(
  runId: string,
  status: "running" | "success" | "failed",
  authToken: string,
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
        Authorization: `Bearer ${authToken}`,
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

async function readWorkflowJson(workflowPath: string): Promise<WorkflowJson> {
  const workflowJsonPath = path.join(workflowPath, "workflow.json")
  const content = await fsp.readFile(workflowJsonPath, "utf-8")
  return JSON.parse(content) as WorkflowJson
}

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

function validateInputs(
  providedInputs: Record<string, unknown>,
  schema: Record<string, WorkflowInput>
): ValidationResult {
  const errors: string[] = []
  const processedInputs: Record<string, string | number | boolean> = {}

  for (const [name, config] of Object.entries(schema)) {
    const value = providedInputs[name]

    if (value === undefined || value === null) {
      if (config.required !== false && config.default === undefined) {
        errors.push(`Missing required input: '${name}'`)
        continue
      }
      if (config.default !== undefined) {
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
      continue
    }

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

function inputsToArgs(inputs: Record<string, string | number | boolean>): string[] {
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

function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Process may already be dead.
  }
}

export function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_")
}

async function isMessageOrSessionAborted(
  sessionID: string,
  directory: string
): Promise<boolean> {
  const query = `directory=${encodeURIComponent(directory)}`
  const statusRes = await fetch(`${OPENCODE_BASE_URL}/session/status?${query}`)
  if (!statusRes.ok) {
    return false
  }
  const statuses = (await statusRes.json()) as Record<string, { type?: string }>
  const state = statuses[sessionID] ?? null
  const sessionType = typeof state?.type === "string" ? state.type : null
  return sessionType !== "busy"
}

function runWithTimeout(
  workflowPath: string,
  args: string[],
  timeoutSeconds: number,
  outputFilePath: string,
  abortSignal: AbortSignal | null,
  cancellationProbe: { sessionID: string; directory: string } | null
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
      detached: true,
    })

    const pid = child.pid
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

    if (cancellationProbe) {
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
    }

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      appendFileOutput(text)
      process.stdout.write(text)
    })

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString()
      appendOutput(text)
      appendFileOutput(text)
      process.stderr.write(text)
    })

    timeoutId = setTimeout(() => {
      cleanup("SIGTERM")
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

    child.on("close", (code) => {
      if (code === 0) {
        safeResolve({ status: "success", output })
      } else if (code !== null) {
        appendOutput(`\n[ERROR] Process exited with code ${code}\n`)
        safeResolve({ status: "error", output })
      }
    })

    child.on("error", (err) => {
      appendOutput(`\n[ERROR] Failed to start process: ${err.message}\n`)
      appendFileOutput(`\n[ERROR] Failed to start process: ${err.message}\n`)
      process.stderr.write(`\n[ERROR] Failed to start process: ${err.message}\n`)
      safeResolve({ status: "error", output })
    })
  })
}

async function rejectWorkflowPermission(
  authToken: string,
  permissionId: string
): Promise<void> {
  await fetch(`${API_BASE_URL}/api/workflows/permission-reject/${permissionId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })
}

async function requestWorkflowPermission(
  authToken: string,
  messageID: string,
  callID: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/workflows/request-permission`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
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
      `${API_BASE_URL}/api/workflows/permission-status/${permissionId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    )

    if (!statusResponse.ok) {
      continue
    }

    const statusData = (await statusResponse.json()) as { status: string }
    if (statusData.status === "approved") {
      return
    }
    if (statusData.status === "rejected") {
      throw new Error("User denied permission to run this workflow.")
    }
  }

  try {
    await rejectWorkflowPermission(authToken, permissionId)
  } catch {
    // Best-effort cleanup only.
  }
  throw new Error("Permission request timed out")
}

export async function startWorkflowRun(
  options: StartWorkflowRunOptions
): Promise<StartedWorkflowRun> {
  if (!SLUG_REGEX.test(options.slug)) {
    throw new Error(
      "Invalid workflow slug. Expected lowercase letters/numbers with optional hyphens (e.g. 'failed-stripe-payments')."
    )
  }

  const workflowsRoot = path.join(options.directory, "workflows")
  const workflowPath = path.join(workflowsRoot, options.slug)
  if (!isPathInside(workflowPath, workflowsRoot)) {
    throw new Error("Invalid workflow path (must be inside workflows/).")
  }

  await assertDirectory(workflowPath)
  const runScript = path.join(workflowPath, "run.py")
  await assertPathExists(runScript)

  if (options.requestPermission) {
    await requestWorkflowPermission(options.authToken, options.messageID, options.callID)
  }

  const workflowJson = await readWorkflowJson(workflowPath)
  await assertVenvExists(workflowPath)
  const venvPython = getVenvPythonPath(workflowPath)
  await assertPathExists(venvPython)

  const inputSchema = workflowJson.inputs || {}
  const validation = validateInputs(options.inputs, inputSchema)
  if (!validation.valid) {
    throw new Error(
      `Input validation failed: ${JSON.stringify(validation.errors)}`
    )
  }

  const timeoutSeconds = parseTimeoutSeconds(workflowJson.runtime?.timeout_seconds)
  if (!timeoutSeconds) {
    throw new Error(
      `Could not read runtime.timeout_seconds from workflow.json for '${options.slug}'`
    )
  }

  const cmdArgs = inputsToArgs(validation.processedInputs)
  const runCreate = await createWorkflowRun(
    options.slug,
    options.inputs,
    options.sessionID,
    options.messageID,
    options.authToken
  )
  if (isApiError(runCreate)) {
    throw new Error(runCreate.message)
  }

  const runId = runCreate.data
  const workflowRunsDir = path.join(options.directory, "workflow-runs")
  await fsp.mkdir(workflowRunsDir, { recursive: true })
  const outputFilePath = path.join(
    workflowRunsDir,
    `${sanitizeFilenamePart(options.sessionID)}-${sanitizeFilenamePart(options.messageID)}.txt`
  )
  await fsp.writeFile(outputFilePath, "", "utf-8")

  const runPromise = runWithTimeout(
    workflowPath,
    cmdArgs,
    timeoutSeconds,
    outputFilePath,
    options.abortSignal,
    options.enableCancellationPolling
      ? { sessionID: options.sessionID, directory: options.directory }
      : null
  )

  const completion = (async (): Promise<WorkflowRunCompletionResult> => {
    const result = await runPromise
    const dbStatus = result.status === "success" ? "success" : "failed"
    const errorMessage = result.status !== "success" ? result.output.slice(-1000) : undefined
    const runUpdate = await updateWorkflowRunStatus(
      runId,
      dbStatus,
      options.authToken,
      errorMessage,
      result.output
    )

    return {
      status: result.status,
      output: result.output,
      warning: isApiError(runUpdate) ? runUpdate.message : null,
    }
  })()

  return {
    runId,
    timeoutSeconds,
    completion,
  }
}

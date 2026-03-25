import fs from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

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

type ToolArgs = Record<string, unknown> | undefined

function findPatchPayload(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.replace(/\r\n/g, "\n")
    if (normalized.includes("*** Begin Patch")) {
      return normalized
    }
    return null
  }

  if (!value || typeof value !== "object") {
    return null
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const match = findPatchPayload(nestedValue)
    if (match) {
      return match
    }
  }

  return null
}

function extractTrackedPathsFromPatch(patchText: string): string[] {
  const normalized = patchText.replace(/\r\n/g, "\n")
  const fileHeaderMatches = normalized.matchAll(/^\s*\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)
  const paths = Array.from(fileHeaderMatches, (match) => match[1].trim()).filter(
    (candidate) => candidate.length > 0
  )

  if (paths.length === 0) {
    throw new Error("Could not determine target path from apply_patch payload.")
  }

  const moveToMatches = normalized.matchAll(/^\s*\*\*\* Move to: (.+)$/gm)
  for (const match of moveToMatches) {
    const targetPath = match[1].trim()
    if (targetPath.length > 0) {
      paths.push(targetPath)
    }
  }

  return Array.from(new Set(paths.filter((candidate) => candidate.length > 0)))
}

function findNestedStringByKeys(value: unknown, keys: Set<string>): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof nestedValue === "string" && nestedValue.trim().length > 0) {
      return nestedValue
    }

    const nestedMatch = findNestedStringByKeys(nestedValue, keys)
    if (nestedMatch) {
      return nestedMatch
    }
  }

  return null
}

function tokenizeCommand(command: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|&&|\|\||[;|]|[^\s]+/g) ?? []
  return tokens.map((token) => {
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1)
    }

    return token
  })
}

const CONTROL_TOKENS = new Set(["&&", "||", ";", "|"])

function resolveExecutionDirectory(rawCwd: unknown, fallbackDirectory: string): string {
  if (typeof rawCwd !== "string" || rawCwd.trim() === "") {
    return fallbackDirectory
  }

  return path.isAbsolute(rawCwd) ? rawCwd : path.resolve(fallbackDirectory, rawCwd)
}

function resolveTrackedDeleteTargets(command: string, executionDirectory: string): string[] {
  const tokens = tokenizeCommand(command.trim())
  if (tokens.length === 0) {
    return []
  }

  const resolvedTargets: string[] = []
  let currentDirectory = executionDirectory
  let index = 0
  let atCommandStart = true

  while (index < tokens.length) {
    const token = tokens[index]

    if (CONTROL_TOKENS.has(token)) {
      atCommandStart = true
      index += 1
      continue
    }

    if (!atCommandStart) {
      index += 1
      continue
    }

    if (token === "cd") {
      const destination = tokens[index + 1]
      if (destination && !CONTROL_TOKENS.has(destination)) {
        currentDirectory = path.isAbsolute(destination)
          ? path.resolve(destination)
          : path.resolve(currentDirectory, destination)
        index += 2
      } else {
        index += 1
      }
      atCommandStart = false
      continue
    }

    if (path.basename(token) === "rm") {
      index += 1
      while (index < tokens.length && !CONTROL_TOKENS.has(tokens[index])) {
        const candidate = tokens[index]
        if (candidate === "--" || candidate.startsWith("-")) {
          index += 1
          continue
        }

        const resolvedCandidate = path.isAbsolute(candidate)
          ? path.resolve(candidate)
          : path.resolve(currentDirectory, candidate)
        if (fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isDirectory()) {
          index += 1
          continue
        }
        resolvedTargets.push(resolvedCandidate)
        index += 1
      }
      atCommandStart = false
      continue
    }

    atCommandStart = false
    index += 1
  }

  return Array.from(new Set(resolvedTargets))
}

function normalizeRelativePath(rawPath: string, workspaceDir: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw new Error("apply_patch hook received an empty file path.")
  }

  const resolvedPath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceDir, trimmed)
  const relativePath = path.relative(workspaceDir, resolvedPath)

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`apply_patch path '${trimmed}' is outside the workspace.`)
  }

  return relativePath.split(path.sep).join("/")
}

function tryNormalizeRelativePath(rawPath: string, workspaceDir: string): string | null {
  try {
    return normalizeRelativePath(rawPath, workspaceDir)
  } catch {
    return null
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
        const message = (parsed as { message?: unknown }).message
        if (typeof message === "string" && message.trim().length > 0) {
          return message
        }
      }
    } catch {
      // Fall back to plain text.
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

function collectTrackedPathsForTool(
  tool: string,
  inputArgs: ToolArgs,
  outputArgs: ToolArgs,
  workspaceDir: string
): string[] {
  if (tool === "apply_patch") {
    const patchPayload = findPatchPayload(outputArgs) ?? findPatchPayload(inputArgs)
    if (!patchPayload) {
      return []
    }

    return extractTrackedPathsFromPatch(patchPayload)
  }

  if (tool === "write") {
    const filepath =
      findNestedStringByKeys(outputArgs, new Set(["filepath", "filePath"])) ??
      findNestedStringByKeys(inputArgs, new Set(["filepath", "filePath"]))
    if (!filepath) {
      return []
    }

    return [filepath]
  }

  if (tool === "bash") {
    const command =
      findNestedStringByKeys(outputArgs, new Set(["command", "cmd", "script", "arguments"])) ??
      findNestedStringByKeys(inputArgs, new Set(["command", "cmd", "script", "arguments"]))
    if (!command) {
      return []
    }

    const rawCwd =
      (outputArgs && (outputArgs.workdir ?? outputArgs.cwd)) ??
      (inputArgs && (inputArgs.workdir ?? inputArgs.cwd))
    const executionDirectory = resolveExecutionDirectory(rawCwd, workspaceDir)

    return resolveTrackedDeleteTargets(command, executionDirectory)
  }

  return []
}

export const ApplyPatchSessionDiffPlugin: Plugin = async ({ client, directory }) => {
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

  async function captureBaselineForPath(sessionID: string, relativePath: string): Promise<void> {
    const response = await fetch(`${getApiBaseUrl()}/api/chat/sessions/file-diff/capture-baseline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionID}`,
      },
      body: JSON.stringify({
        path: relativePath,
      }),
    })

    if (!response.ok) {
      const errorMessage = await readErrorMessageFromResponse(
        response,
        `Failed to capture file baseline for ${relativePath} (HTTP ${response.status})`
      )
      throw new Error(errorMessage)
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!["apply_patch", "write", "bash"].includes(input.tool)) {
        return
      }

      const rawSessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!rawSessionID) {
        return
      }

      const rootSessionID = await resolveRootSessionID(rawSessionID)
      const paths = collectTrackedPathsForTool(input.tool, input.args, output.args, directory)
      for (const candidatePath of paths) {
        const relativePath = tryNormalizeRelativePath(candidatePath, directory)
        if (!relativePath) {
          continue
        }
        await captureBaselineForPath(rootSessionID, relativePath)
      }
    },
  }
}

export default ApplyPatchSessionDiffPlugin

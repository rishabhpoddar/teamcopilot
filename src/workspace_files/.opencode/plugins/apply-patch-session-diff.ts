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
      if (input.tool !== "apply_patch") {
        return
      }

      const rawSessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!rawSessionID) {
        throw new Error("apply_patch hook could not determine session ID.")
      }

      const rootSessionID = await resolveRootSessionID(rawSessionID)
      const patchPayload = findPatchPayload(output.args) ?? findPatchPayload(input.args)
      if (!patchPayload) {
        throw new Error("apply_patch hook could not find patch payload.")
      }

      const paths = extractTrackedPathsFromPatch(patchPayload)
      for (const candidatePath of paths) {
        const relativePath = normalizeRelativePath(candidatePath, directory)
        await captureBaselineForPath(rootSessionID, relativePath)
      }
    },
  }
}

export default ApplyPatchSessionDiffPlugin

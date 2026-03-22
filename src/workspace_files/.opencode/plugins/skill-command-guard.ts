import type { Plugin } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}

interface SkillDetailsResponse {
  skill?: {
    is_approved?: boolean
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
      // fall back to plain text
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

export function normalizeCommandSlug(command: string): string {
  const trimmed = command.trim()
  const match = trimmed.match(/^\/+([^\s]+)/)
  return match?.[1] ?? ""
}

function getTaskCommand(args: unknown): string | null {
  if (!args || typeof args !== "object" || !("command" in args)) {
    return null
  }

  const command = (args as { command?: unknown }).command
  if (typeof command !== "string") {
    return null
  }

  const normalized = normalizeCommandSlug(command)
  return normalized.length > 0 ? normalized : null
}

interface SessionLookupResponse {
  error?: unknown
  data?: {
    id?: string
    parentID?: string
  }
}

export const SkillCommandGuard: Plugin = async ({ client }) => {
  async function resolveRootSessionID(sessionID: string): Promise<string> {
    let currentSessionID = sessionID

    while (true) {
      const response = (await client.session.get({
        path: {
          id: currentSessionID,
        },
      })) as SessionLookupResponse
      if (response.error) {
        return currentSessionID
      }
      const parentID = response.data?.parentID
      if (!parentID) {
        return currentSessionID
      }
      currentSessionID = parentID
    }
  }

  async function assertAuthorizedSkillCommand(sessionID: string, slug: string): Promise<void> {
    const rootSessionID = await resolveRootSessionID(sessionID)
    const skillDetailsResponse = await fetch(
      `${getApiBaseUrl()}/api/skills/${encodeURIComponent(slug)}`,
      {
        headers: {
          Authorization: `Bearer ${rootSessionID}`,
        },
      }
    )

    if (skillDetailsResponse.status === 404) {
      return
    }

    if (!skillDetailsResponse.ok) {
      const errorMessage = await readErrorMessageFromResponse(
        skillDetailsResponse,
        `Failed to fetch skill metadata for ${slug} (HTTP ${skillDetailsResponse.status})`
      )
      throw new Error(errorMessage)
    }

    const skillDetailsPayload =
      (await skillDetailsResponse.json()) as SkillDetailsResponse
    const isApproved = skillDetailsPayload.skill?.is_approved === true

    if (!isApproved) {
      throw new Error(
        `Skill "${slug}" is not approved yet. Only approved skills can be used.`
      )
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") {
        return
      }

      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      const slug = getTaskCommand(output.args)
      if (!sessionID || !slug) {
        return
      }

      await assertAuthorizedSkillCommand(sessionID, slug)
    },
  }
}

export default SkillCommandGuard

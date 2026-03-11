import { type Plugin, tool } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}



interface SkillSummary {
  slug: string
  name: string
  description: string
  is_approved: boolean
  can_edit: boolean
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

export const ListAvailableSkillsPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      listAvailableSkills: tool({
        description:
          "List custom skills that are available for this user to use. Returns only approved skills that the current user has permission to run.",
        args: {},
        async execute(_args, context) {
          const { sessionID } = context

          const response = await fetch(`${getApiBaseUrl()}/api/skills`, {
            headers: {
              Authorization: `Bearer ${sessionID}`,
            },
          })

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to list skills (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = (await response.json()) as {
            skills?: SkillSummary[]
          }

          const availableSkills = (payload.skills ?? [])
            .filter((skill) => skill.is_approved)
            .map((skill) => ({
              slug: skill.slug,
              name: skill.name,
              description: skill.description,
            }))

          return JSON.stringify(
            {
              skills: availableSkills,
              total: availableSkills.length,
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default ListAvailableSkillsPlugin

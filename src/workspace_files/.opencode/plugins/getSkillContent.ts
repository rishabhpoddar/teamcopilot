import { type Plugin, tool } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}


const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface SessionLookupResponse {
  error?: unknown
  data?: {
    id?: string
    parentID?: string
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

export const GetSkillContentPlugin: Plugin = async ({ client }) => {
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

  return {
    tool: {
      getSkillContent: tool({
        description:
          "Get the contents of a skill by slug. Uses backend auth and permission checks; returns the original SKILL.md content plus required secret key metadata when the current user has access and all required secrets are configured.",
        args: {
          slug: tool.schema
            .string()
            .describe("Skill slug (lowercase letters/numbers with hyphens)"),
        },
        async execute(args, context) {
          const { sessionID } = context
          const slug = args.slug.trim()
          const authSessionID = await resolveRootSessionID(sessionID)

          if (!SLUG_REGEX.test(slug)) {
            throw new Error(
              `Invalid slug format: "${slug}". Slug must be lowercase alphanumeric with hyphens (e.g., "my-skill-name").`
            )
          }

          const response = await fetch(
            `${getApiBaseUrl()}/api/skills/${encodeURIComponent(slug)}/runtime-content`,
            {
              headers: {
                Authorization: `Bearer ${authSessionID}`,
              },
            }
          )

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to get runtime skill content for ${slug} (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = (await response.json()) as {
            skill?: {
              slug?: string
              path?: string
              content?: string
            }
          }

          return JSON.stringify(
            {
              skill: {
                slug: payload.skill?.slug ?? slug,
                path: payload.skill?.path ?? "SKILL.md",
                content: payload.skill?.content ?? "",
              },
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default GetSkillContentPlugin

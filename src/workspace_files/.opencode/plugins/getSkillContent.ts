import { type Plugin, tool } from "@opencode-ai/plugin"

const API_BASE_URL = "http://localhost:3000"
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface SkillFileContentResponse {
  path: string
  kind: "text" | "binary"
  content?: string
}

interface SkillDetailsResponse {
  workflow?: {
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

export const GetSkillContentPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      getSkillContent: tool({
        description:
          "Get the contents of a skill by slug. Uses backend auth and permission checks; returns SKILL.md content only if the current user has access.",
        args: {
          slug: tool.schema
            .string()
            .describe("Skill slug (lowercase letters/numbers with hyphens)"),
        },
        async execute(args, context) {
          const { sessionID } = context
          const slug = args.slug.trim()

          if (!SLUG_REGEX.test(slug)) {
            throw new Error(
              `Invalid slug format: "${slug}". Slug must be lowercase alphanumeric with hyphens (e.g., "my-skill-name").`
            )
          }

          const skillDetailsResponse = await fetch(
            `${API_BASE_URL}/api/skills/${encodeURIComponent(slug)}`,
            {
              headers: {
                Authorization: `Bearer ${sessionID}`,
              },
            }
          )

          if (!skillDetailsResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              skillDetailsResponse,
              `Failed to fetch skill metadata for ${slug} (HTTP ${skillDetailsResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const skillDetailsPayload =
            (await skillDetailsResponse.json()) as SkillDetailsResponse
          const isApproved = skillDetailsPayload.workflow?.is_approved === true

          if (!isApproved) {
            throw new Error(
              `Skill \"${slug}\" is not approved yet. Only approved skills can be read through getSkillContent.`
            )
          }

          const response = await fetch(
            `${API_BASE_URL}/api/skills/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent("SKILL.md")}`,
            {
              headers: {
                Authorization: `Bearer ${sessionID}`,
              },
            }
          )

          if (!response.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              response,
              `Failed to get skill content for ${slug} (HTTP ${response.status})`
            )
            throw new Error(errorMessage)
          }

          const payload = (await response.json()) as SkillFileContentResponse
          if (payload.kind !== "text") {
            throw new Error(`SKILL.md for ${slug} is not a text file.`)
          }

          return JSON.stringify(
            {
              skill: {
                slug,
                path: payload.path,
                content: payload.content ?? "",
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

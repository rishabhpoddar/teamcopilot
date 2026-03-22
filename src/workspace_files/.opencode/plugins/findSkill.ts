import { type Plugin, tool } from "@opencode-ai/plugin"
import { pipeline } from "@huggingface/transformers"

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

interface SkillFileContentResponse {
  kind: "text" | "binary"
  content?: string
}

interface SkillMatch {
  slug: string
  name: string
  description: string
  similarity: number
}

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

function stripLeadingFrontmatter(markdown: string): string {
  const trimmedStart = markdown.trimStart()
  if (!trimmedStart.startsWith("---\n")) {
    return markdown.trim()
  }

  const frontmatterEnd = trimmedStart.indexOf("\n---\n", 4)
  if (frontmatterEnd < 0) {
    return markdown.trim()
  }

  return trimmedStart.slice(frontmatterEnd + "\n---\n".length).trim()
}

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null

async function getEmbedding(text: string): Promise<number[]> {
  if (extractor === null) {
    extractor = await pipeline(
      "feature-extraction",
      "sentence-transformers/all-MiniLM-L6-v2",
      { dtype: "fp32" }
    )
  }

  const output = await extractor(text, { pooling: "mean", normalize: true })
  return Array.from(output.data as Float32Array)
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}

async function readSkillMarkdown(
  authSessionID: string,
  slug: string
): Promise<string> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/skills/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent("SKILL.md")}`,
    {
      headers: {
        Authorization: `Bearer ${authSessionID}`,
      },
    }
  )

  if (!response.ok) {
    const errorMessage = await readErrorMessageFromResponse(
      response,
      `Failed to read SKILL.md for ${slug} (HTTP ${response.status})`
    )
    throw new Error(errorMessage)
  }

  const payload = (await response.json()) as SkillFileContentResponse
  if (payload.kind !== "text") {
    throw new Error(`SKILL.md for ${slug} is not a text file.`)
  }

  return payload.content ?? ""
}

export const FindSkillPlugin: Plugin = async ({ client, directory }) => {
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

  return {
    tool: {
      findSkill: tool({
        description:
          "Find similar custom skills. Searches only approved skills that the current user can edit, using both skill descriptions and SKILL.md body content.",
        args: {
          description: tool.schema
            .string()
            .describe("Natural language description of the skill you are looking for"),
          limit: tool.schema
            .number()
            .optional()
            .default(5)
            .describe("Maximum number of results to return (default: 5)"),
        },
        async execute(args, context) {
          const { sessionID } = context
          const description = args.description.trim()
          const limit = args.limit

          if (!description) {
            throw new Error("description is required")
          }

          const authSessionID = await resolveRootSessionID(sessionID)
          const skillsResponse = await fetch(`${getApiBaseUrl()}/api/skills`, {
            headers: {
              Authorization: `Bearer ${authSessionID}`,
            },
          })

          if (!skillsResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              skillsResponse,
              `Failed to list skills (HTTP ${skillsResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const skillsPayload = (await skillsResponse.json()) as {
            skills?: SkillSummary[]
          }
          const candidateSkills = (skillsPayload.skills ?? []).filter(
            (skill) => skill.is_approved
          )

          if (candidateSkills.length === 0) {
            return JSON.stringify(
              {
                matches: [],
                message:
                  "No approved skills available for this user with edit access.",
              },
              null,
              2
            )
          }

          const queryEmbedding = await getEmbedding(description)
          const matches: SkillMatch[] = []

          for (const skill of candidateSkills) {
            const markdown = await readSkillMarkdown(authSessionID, skill.slug)
            const searchableText = `${skill.description}\n\n${stripLeadingFrontmatter(markdown)}`
            const skillEmbedding = await getEmbedding(searchableText)
            const similarity = cosineSimilarity(queryEmbedding, skillEmbedding)

            matches.push({
              slug: skill.slug,
              name: skill.name,
              description: skill.description,
              similarity: Math.round(similarity * 100) / 100,
            })
          }

          matches.sort((a, b) => b.similarity - a.similarity)

          return JSON.stringify(
            {
              matches: matches.slice(0, limit),
            },
            null,
            2
          )
        },
      }),
    },
  }
}

export default FindSkillPlugin

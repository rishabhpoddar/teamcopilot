import { type Plugin, tool } from "@opencode-ai/plugin"
import * as fs from "fs/promises"
import * as path from "path"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}


const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface SkillFileContentResponse {
  path: string
  kind: "text" | "binary"
  content?: string
  etag: string
}

interface PermissionResponse {
  approved: boolean
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const parent = path.resolve(parentPath) + path.sep
  const child = path.resolve(childPath) + path.sep
  return child.startsWith(parent)
}

async function rejectCreationPermission(
  sessionID: string,
  permissionId: string
): Promise<void> {
  await fetch(`${getApiBaseUrl()}/api/workflows/permission-reject/${permissionId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionID}`,
    },
  })
}

async function requestCreationPermission(
  sessionID: string,
  messageID: string,
  callID: string
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/workflows/request-permission`, {
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

  const maxAttempts = 300
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const statusResponse = await fetch(
      `${getApiBaseUrl()}/api/workflows/permission-status/${permissionId}`,
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
      throw new Error("User denied permission to create this skill.")
    }
  }

  try {
    await rejectCreationPermission(sessionID, permissionId)
  } catch {
    // Best-effort cleanup only; preserve the timeout error below.
  }
  throw new Error("Permission request timed out")
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

function buildSkillMarkdown(
  slug: string,
  description: string,
  markdownContent: string
): string {
  const body = stripLeadingFrontmatter(markdownContent)
  return `---\nname: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`
}

export const CreateSkillPlugin: Plugin = async ({ client }) => {
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
      createSkill: tool({
        description:
          "Create a new custom skill. Creates the skill directory, updates database metadata, and writes SKILL.md with provided description and markdown content.",
        args: {
          slug: tool.schema
            .string()
            .describe("Skill slug (lowercase letters/numbers with hyphens)"),
          description: tool.schema
            .string()
            .describe("Short description of what this skill does"),
          content: tool.schema
            .string()
            .describe("Markdown content to store in SKILL.md"),
        },
        async execute(args, context) {
          const { directory, sessionID } = context
          const authSessionID = await resolveRootSessionID(sessionID)
          const slug = args.slug.trim()
          const description = args.description.trim()
          const content = args.content.trim()
          const messageId = extractMessageId(context)
          const callId = extractCallId(context)

          if (!SLUG_REGEX.test(slug)) {
            throw new Error(
              `Invalid slug format: "${slug}". Slug must be lowercase alphanumeric with hyphens (e.g., "my-skill-name").`
            )
          }

          if (!description) {
            throw new Error("description is required")
          }

          if (!content) {
            throw new Error("content is required")
          }

          if (!messageId) {
            throw new Error("Could not determine message id from tool context.")
          }

          if (!callId) {
            throw new Error("Could not determine call id from tool context.")
          }

          const skillsDir = path.join(directory, ".agents", "skills")
          const skillDir = path.join(skillsDir, slug)

          if (!isPathInside(skillDir, skillsDir)) {
            throw new Error("Path traversal detected. Invalid slug.")
          }

          if (await pathExists(skillDir)) {
            throw new Error(`Skill "${slug}" already exists at ${skillDir}`)
          }

          await requestCreationPermission(
            authSessionID,
            messageId,
            callId
          )

          const createResponse = await fetch(`${getApiBaseUrl()}/api/skills`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSessionID}`,
            },
            body: JSON.stringify({
              name: slug,
            }),
          })

          if (!createResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              createResponse,
              `Failed to create skill (HTTP ${createResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const readResponse = await fetch(
            `${getApiBaseUrl()}/api/skills/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent("SKILL.md")}`,
            {
              headers: {
                Authorization: `Bearer ${authSessionID}`,
              },
            }
          )

          if (!readResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              readResponse,
              `Failed to load SKILL.md for ${slug} (HTTP ${readResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const filePayload = (await readResponse.json()) as SkillFileContentResponse
          if (filePayload.kind !== "text") {
            throw new Error(`SKILL.md for ${slug} is not a text file.`)
          }

          const nextContent = buildSkillMarkdown(slug, description, content)

          const saveResponse = await fetch(`${getApiBaseUrl()}/api/skills/${encodeURIComponent(slug)}/files/content`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSessionID}`,
            },
            body: JSON.stringify({
              path: "SKILL.md",
              content: nextContent,
              base_etag: filePayload.etag,
            }),
          })

          if (!saveResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              saveResponse,
              `Failed to save SKILL.md for ${slug} (HTTP ${saveResponse.status})`
            )
            throw new Error(errorMessage)
          }

          return JSON.stringify(
            {
              skill: {
                slug,
                description,
                file_path: `.agents/skills/${slug}/SKILL.md`,
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

export default CreateSkillPlugin

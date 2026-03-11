import { type Plugin, tool } from "@opencode-ai/plugin"
import { pipeline } from "@huggingface/transformers"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}



// ============================================================================
// Types
// ============================================================================

interface WorkflowMatch {
  path: string
  similarity: number
  summary: string
}

interface WorkflowSummary {
  slug: string
  intent_summary: string
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

// ============================================================================
// Embedding Functions
// ============================================================================

// Cache the extractor pipeline
let extractor: Awaited<ReturnType<typeof pipeline>> | null = null

/**
 * Get embedding vector for text using sentence-transformers/all-MiniLM-L6-v2
 */
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

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}

// ============================================================================
// Plugin
// ============================================================================

export const FindSimilarWorkflowPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      findSimilarWorkflow: tool({
        description:
          "Query for existing workflows before creating new ones or for searching for a workflow to run. Returns up to N candidate workflows with paths and summaries based on semantic similarity to the provided description. Use this to avoid duplicate work and find workflows that can be reused or adapted.",
        args: {
          description: tool.schema
            .string()
            .describe(
              "Natural language description of what you're looking for"
            ),
          limit: tool.schema
            .number()
            .optional()
            .default(5)
            .describe("Maximum number of results to return (default: 5)"),
        },
        async execute(args, context) {
          const { sessionID } = context
          const { description, limit = 5 } = args

          const workflowsResponse = await fetch(`${getApiBaseUrl()}/api/workflows`, {
            headers: {
              Authorization: `Bearer ${sessionID}`,
            },
          })

          if (!workflowsResponse.ok) {
            const errorMessage = await readErrorMessageFromResponse(
              workflowsResponse,
              `Failed to list workflows (HTTP ${workflowsResponse.status})`
            )
            throw new Error(errorMessage)
          }

          const workflowsPayload = (await workflowsResponse.json()) as {
            workflows?: WorkflowSummary[]
          }
          const candidateWorkflows = workflowsPayload.workflows ?? []

          if (candidateWorkflows.length === 0) {
            return JSON.stringify(
              {
                matches: [],
                message:
                  "No workflows available for this user with access permissions.",
              },
              null,
              2
            )
          }

          // Get embedding for the query description
          const queryEmbedding = await getEmbedding(description)

          const matches: WorkflowMatch[] = []

          for (const workflow of candidateWorkflows) {
            const summary = workflow.intent_summary

            // Get embedding for the workflow's intent_summary
            const workflowEmbedding = await getEmbedding(summary)

            // Calculate cosine similarity
            const similarity = cosineSimilarity(queryEmbedding, workflowEmbedding)

            matches.push({
              path: `workflows/${workflow.slug}`,
              similarity: Math.round(similarity * 100) / 100,
              summary,
            })
          }

          // Sort by similarity descending and take top N
          matches.sort((a, b) => b.similarity - a.similarity)
          const topMatches = matches.slice(0, limit)

          return JSON.stringify({ matches: topMatches }, null, 2)
        },
      }),
    },
  }
}

export default FindSimilarWorkflowPlugin

import { type Plugin, tool } from "@opencode-ai/plugin"
import { pipeline } from "@huggingface/transformers"
import * as path from "path"
import {
  type WorkflowMatch,
  readWorkflowJson,
  getWorkflowDirs,
} from "./shared"

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

export const FindSimilarWorkflowPlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      findSimilarWorkflow: tool({
        description:
          "Query for existing workflows before creating new ones. Returns up to N candidate workflows with paths and summaries based on semantic similarity to the provided description. Use this to avoid duplicate work and find workflows that can be reused or adapted.",
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
          const { directory } = context
          const { description, limit = 5 } = args

          const workflowDirs = await getWorkflowDirs(directory)

          if (workflowDirs.length === 0) {
            return JSON.stringify({
              matches: [],
              message: "No workflows found in the workflows/ directory",
            })
          }

          // Get embedding for the query description
          const queryEmbedding = await getEmbedding(description)

          const matches: WorkflowMatch[] = []

          for (const workflowPath of workflowDirs) {
            const workflowJson = await readWorkflowJson(workflowPath)

            // Only include workflows that have an intent_summary
            if (!workflowJson?.intent_summary) {
              continue
            }

            const summary = workflowJson.intent_summary

            // Get embedding for the workflow's intent_summary
            const workflowEmbedding = await getEmbedding(summary)

            // Calculate cosine similarity
            const similarity = cosineSimilarity(queryEmbedding, workflowEmbedding)

            matches.push({
              path: path.relative(directory, workflowPath),
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

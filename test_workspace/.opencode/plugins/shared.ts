import * as fs from "fs/promises"
import * as path from "path"

// ============================================================================
// Types
// ============================================================================

export interface WorkflowInput {
  type: "string" | "number" | "boolean" | "integer"
  required?: boolean
  default?: string | number | boolean
  description?: string
}

export interface WorkflowJson {
  intent_summary?: string
  inputs?: Record<string, WorkflowInput>
  triggers?: Record<string, unknown>
  runtime?: {
    python_version?: string
    timeout_seconds?: number
  }
}

export interface WorkflowMatch {
  path: string
  similarity: number
  summary: string
}

// ============================================================================
// Common Functions
// ============================================================================

/**
 * Reads and parses workflow.json from a workflow directory.
 */
export async function readWorkflowJson(
  workflowPath: string
): Promise<WorkflowJson | null> {
  const workflowJsonPath = path.join(workflowPath, "workflow.json")
  try {
    const content = await fs.readFile(workflowJsonPath, "utf-8")
    return JSON.parse(content) as WorkflowJson
  } catch {
    return null
  }
}

/**
 * Gets all workflow directories from the workflows/ folder.
 */
export async function getWorkflowDirs(workspaceDir: string): Promise<string[]> {
  const workflowsDir = path.join(workspaceDir, "workflows")
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(workflowsDir, entry.name))
  } catch {
    return []
  }
}

/**
 * Checks if the workflow's .venv exists.
 */
export async function venvExists(workflowPath: string): Promise<boolean> {
  const venvPath = path.join(workflowPath, ".venv")
  try {
    const stats = await fs.stat(venvPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

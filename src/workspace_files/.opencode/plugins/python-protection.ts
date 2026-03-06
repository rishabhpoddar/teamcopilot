import type { Plugin } from "@opencode-ai/plugin"
import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

const pythonInterpreterPattern =
    /(^|[\s;|&()])(?:\/[\w./-]*python(?:\d+(?:\.\d+)*)?|python(?:\d+(?:\.\d+)*)?|py|pypy)(?=$|[\s;|&()])/i

const tokenizeCommand = (command: string): string[] => {
    const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []
    return tokens.map((token) => {
        if (
            (token.startsWith("\"") && token.endsWith("\"")) ||
            (token.startsWith("'") && token.endsWith("'"))
        ) {
            return token.slice(1, -1)
        }
        return token
    })
}

const isPythonInterpreterToken = (token: string): boolean => {
    const base = path.basename(token)
    return /^(?:python(?:\d+(?:\.\d+)*)?|py|pypy)$/i.test(base)
}

const resolveRunPyTarget = (command: string, cwd: string): string | null => {
    const tokens = tokenizeCommand(command)
    const pythonIndex = tokens.findIndex(isPythonInterpreterToken)
    if (pythonIndex === -1) {
        return null
    }

    for (let i = pythonIndex + 1; i < tokens.length; i += 1) {
        const token = tokens[i]
        if (token === "-m" || token === "-c" || token === "-") {
            return null
        }
        if (token.startsWith("-")) {
            continue
        }
        if (path.basename(token) !== "run.py") {
            return null
        }
        return path.resolve(cwd, token)
    }

    return null
}

const getWorkflowRunPyFiles = async (workspaceRoot: string): Promise<string[]> => {
    const workflowsDir = path.join(workspaceRoot, "workflows")
    let entries: Dirent[]
    try {
        entries = await fs.readdir(workflowsDir, { withFileTypes: true })
    } catch {
        return []
    }
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(workflowsDir, entry.name, "run.py"))
}

const shouldBlockByContentMatch = async (targetRunPy: string, workspaceRoot: string): Promise<boolean> => {
    let targetContent: string
    try {
        targetContent = await fs.readFile(targetRunPy, "utf8")
    } catch {
        return false
    }
    const workflowRunPyFiles = await getWorkflowRunPyFiles(workspaceRoot)

    for (const workflowRunPy of workflowRunPyFiles) {
        try {
            const workflowContent = await fs.readFile(workflowRunPy, "utf8")
            if (workflowContent === targetContent) {
                return true
            }
        } catch {
            // Ignore missing/unreadable workflow run.py files.
        }
    }

    return false
}

export const PythonProtection: Plugin = async ({ directory, worktree }) => {
    return {
        "tool.execute.before": async (input, output) => {
            if (input.tool !== "bash") {
                return
            }

            const command = output.args.command
            if (!pythonInterpreterPattern.test(command)) {
                return
            }

            const targetRunPy = resolveRunPyTarget(command, directory)
            if (!targetRunPy) {
                return
            }

            const workspaceRoot = worktree || directory
            if (await shouldBlockByContentMatch(targetRunPy, workspaceRoot)) {
                throw new Error("Direct workflow execution via Python is not allowed. Use the runWorkflow tool instead.")
            }
        },
    }
}

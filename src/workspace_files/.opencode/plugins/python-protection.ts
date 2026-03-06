import type { Plugin } from "@opencode-ai/plugin"
import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

const pythonInterpreterPattern =
    /(^|[\s;|&()])(?:\/[\w./-]*python(?:\d+(?:\.\d+)*)?|python(?:\d+(?:\.\d+)*)?|py|pypy)(?=$|[\s;|&()])/i

const tokenizeCommand = (command: string): string[] => {
    const tokens = command.match(/"[^"]*"|'[^']*'|&&|\|\||[;|]|[^\s]+/g) ?? []
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

const CONTROL_TOKENS = new Set(["&&", "||", ";", "|"])

const resolveCommandCwd = (rawCwd: unknown, fallbackDirectory: string): string => {
    if (typeof rawCwd !== "string" || rawCwd.trim() === "") {
        return fallbackDirectory
    }
    return path.isAbsolute(rawCwd) ? rawCwd : path.resolve(fallbackDirectory, rawCwd)
}

const resolveRunPyTarget = (command: string, executionCwd: string): string | null => {
    const tokens = tokenizeCommand(command)
    let currentCwd = executionCwd

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]

        if (token === "cd") {
            const destination = tokens[i + 1]
            if (destination && !CONTROL_TOKENS.has(destination)) {
                currentCwd = path.resolve(currentCwd, destination)
                i += 1
            }
            continue
        }

        if (!isPythonInterpreterToken(token)) {
            continue
        }

        for (let j = i + 1; j < tokens.length; j += 1) {
            const nextToken = tokens[j]
            if (CONTROL_TOKENS.has(nextToken)) {
                break
            }
            if (nextToken === "-m" || nextToken === "-c" || nextToken === "-") {
                break
            }
            if (nextToken.startsWith("-")) {
                continue
            }
            if (path.basename(nextToken) === "run.py") {
                return path.resolve(currentCwd, nextToken)
            }
            break
        }
    }

    return null
}

const getWorkflowRunPyFilesFromDir = async (workflowsDir: string): Promise<string[]> => {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(workflowsDir, { withFileTypes: true })
    } catch {
        return []
    }
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(workflowsDir, entry.name, "run.py"))
}

const getWorkflowRunPyFiles = async (roots: string[]): Promise<string[]> => {
    const all = new Set<string>()
    for (const root of roots) {
        const candidates = [
            path.join(root, "workflows"),
            path.join(root, "src", "workspace_files", "workflows"),
        ]
        for (const workflowsDir of candidates) {
            const files = await getWorkflowRunPyFilesFromDir(workflowsDir)
            for (const file of files) {
                all.add(file)
            }
        }
    }
    return Array.from(all)
}

const shouldBlockByContentMatch = async (targetRunPy: string, roots: string[]): Promise<boolean> => {
    let targetContent: string
    try {
        targetContent = await fs.readFile(targetRunPy, "utf8")
    } catch {
        return false
    }
    const workflowRunPyFiles = await getWorkflowRunPyFiles(roots)

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
    const checkCommand = async (command: string, rawCwd?: unknown): Promise<void> => {
        if (!pythonInterpreterPattern.test(command)) {
            return
        }

        const commandCwd = resolveCommandCwd(rawCwd, directory)
        let targetRunPy = resolveRunPyTarget(command, commandCwd)
        if (!targetRunPy && /(^|[\/\s])run\.py($|[\s;|&()])/.test(command)) {
            targetRunPy = path.resolve(commandCwd, "run.py")
        }
        if (!targetRunPy) {
            return
        }

        const roots = Array.from(new Set([
            directory,
            worktree,
            path.resolve(directory, ".."),
            path.resolve(directory, "../.."),
            path.resolve(commandCwd, ".."),
            path.resolve(commandCwd, "../.."),
        ].filter(Boolean)))

        if (await shouldBlockByContentMatch(targetRunPy, roots)) {
            throw new Error("Direct workflow execution via Python is not allowed. Use the runWorkflow tool instead.")
        }
    }

    return {
        "command.execute.before": async (input) => {
            const command = [input.command, input.arguments].filter(Boolean).join(" ").trim()
            if (!command) {
                return
            }
            await checkCommand(command, directory)
        },
        "tool.execute.before": async (input, output) => {
            const commandCandidates: unknown[] = [
                output.args?.command,
                output.args?.cmd,
                output.args?.arguments,
                output.args?.script,
                (input as { args?: { command?: string; cmd?: string; arguments?: string; script?: string } }).args?.command,
                (input as { args?: { command?: string; cmd?: string; arguments?: string; script?: string } }).args?.cmd,
                (input as { args?: { command?: string; cmd?: string; arguments?: string; script?: string } }).args?.arguments,
                (input as { args?: { command?: string; cmd?: string; arguments?: string; script?: string } }).args?.script,
            ]
            const commandValue = commandCandidates.find((value) => typeof value === "string" && value.trim() !== "")
            if (typeof commandValue !== "string") {
                return
            }

            const commandCwd = output.args?.workdir ?? output.args?.cwd ?? input.args?.workdir ?? input.args?.cwd
            await checkCommand(commandValue, commandCwd)
        },
    }
}

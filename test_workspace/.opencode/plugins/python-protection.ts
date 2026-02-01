import type { Plugin } from "@opencode-ai/plugin"

export const PythonProtection: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
        "tool.execute.before": async (input, output) => {
            if (input.tool === "bash" && output.args.command.includes("python") && output.args.command.includes("run.py")) {
                throw new Error("Do not run python scripts directly. Use the runWorkflow tool instead.")
            }
        },
    }
}
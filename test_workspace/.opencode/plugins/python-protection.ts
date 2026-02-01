import type { Plugin } from "@opencode-ai/plugin"

export const PythonProtection: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
        "tool.execute.before": async (input, output) => {
            // TODO: This needs to be tested..
            if (input.tool === "bash" && output.args.filePath.includes("python") && output.args.filePath.includes("run.py")) {
                throw new Error("Do not run python scripts directly. Use the runWorkflow tool instead.")
            }
        },
    }
}
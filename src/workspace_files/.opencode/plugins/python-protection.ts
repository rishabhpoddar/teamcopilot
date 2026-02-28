import type { Plugin } from "@opencode-ai/plugin"

export const PythonProtection: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
        "tool.execute.before": async (input, output) => {
            if (input.tool !== "bash") {
                return
            }

            const command = output.args.command
            const pythonInterpreterPattern =
                /(^|[\s;|&()])(?:\/[\w./-]*python(?:\d+(?:\.\d+)*)?|python(?:\d+(?:\.\d+)*)?|py|pypy)(?=$|[\s;|&()])/i

            if (command.includes(".venv")) {
                return
            }

            if (pythonInterpreterPattern.test(command)) {
                throw new Error("Direct Python execution is not allowed. Use the runWorkflow tool instead. If the workflow for what you want to do doesn't exist, create a new workflow for that.")
            }
        },
    }
}

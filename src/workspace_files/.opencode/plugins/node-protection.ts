import type { Plugin } from "@opencode-ai/plugin"

export const NodeProtection: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
        "tool.execute.before": async (input, output) => {
            if (input.tool !== "bash") {
                return
            }

            const command = output.args.command
            const nodeInterpreterPattern =
                /(^|[\s;|&()])(?:\/[\w./-]*node(?:js)?|node(?:js)?)(?=$|[\s;|&()])/i

            if (nodeInterpreterPattern.test(command)) {
                throw new Error("Direct Node execution is not allowed. Use the runWorkflow tool instead. If the workflow for what you want to do doesn't exist, create a new workflow for that.")
            }
        },
    }
}

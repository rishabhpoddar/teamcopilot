import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs/promises"
import * as path from "path"

const HONEYTOKEN_UUID = "1f9f0b72-5f9f-4c9b-aef1-2fb2e0f6d8c4"
const HONEYTOKEN_FILE_NAME = `honeytoken-${HONEYTOKEN_UUID}.txt`
let isHoneytokenReady = false

async function ensureHoneytokenFile(workspaceDirectory: string): Promise<void> {
    if (isHoneytokenReady) {
        return
    }

    const honeytokenValue = `DO_NOT_EXPOSE:${HONEYTOKEN_UUID}\n`
    const workflowsDirectory = path.join(workspaceDirectory, "workflows")
    await fs.mkdir(workflowsDirectory, { recursive: true })
    const workflowsHoneytokenPath = path.join(workflowsDirectory, HONEYTOKEN_FILE_NAME)
    await fs.writeFile(workflowsHoneytokenPath, honeytokenValue, "utf-8")

    const skillsDirectory = path.join(workspaceDirectory, "custom-skills")
    await fs.mkdir(skillsDirectory, { recursive: true })
    const honeytokenPath = path.join(skillsDirectory, HONEYTOKEN_FILE_NAME)
    await fs.writeFile(honeytokenPath, honeytokenValue, "utf-8")
    isHoneytokenReady = true
}

function includesHoneytoken(value: unknown): boolean {
    if (typeof value !== "string") {
        return false
    }
    return value.includes(HONEYTOKEN_UUID)
}

export const HoneytokenProtection: Plugin = async ({ directory }) => {
    return {
        "tool.execute.before": async (input) => {
            if (input.tool !== "bash") {
                return
            }

            await ensureHoneytokenFile(directory)
        },
        "tool.execute.after": async (input, output) => {
            if (input.tool !== "bash") {
                return
            }

            if (includesHoneytoken(output.output) || includesHoneytoken(JSON.stringify(output.metadata))) {
                throw new Error("Command output matched a protected workspace honeytoken and was blocked.")
            }
        },
    }
}

export default HoneytokenProtection

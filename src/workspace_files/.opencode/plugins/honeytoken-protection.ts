import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs/promises"
import * as path from "path"

const HONEYTOKEN_UUID = "1f9f0b72-5f9f-4c9b-aef1-2fb2e0f6d8c4"
const HONEYTOKEN_FILE_NAME = `honeytoken-${HONEYTOKEN_UUID}.txt`
const HONEYTOKEN_MARKER = `DO_NOT_EXPOSE:${HONEYTOKEN_UUID}`
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
    if (value === undefined) {
        return false
    }

    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value)

    if (!text) {
        return false
    }

    return text.includes(HONEYTOKEN_UUID) || text.includes(HONEYTOKEN_FILE_NAME) || text.includes(HONEYTOKEN_MARKER)
}

export const HoneytokenProtection: Plugin = async ({ directory }) => {
    return {
        "tool.execute.before": async () => {
            await ensureHoneytokenFile(directory)
        },
        "tool.execute.after": async (input, output) => {
            if (
                includesHoneytoken(output.output) ||
                includesHoneytoken(output.metadata) ||
                includesHoneytoken(output.title) ||
                includesHoneytoken(output) ||
                includesHoneytoken(input.args)
            ) {
                throw new Error(`Tool output matched a protected workspace honeytoken and was blocked (tool: ${input.tool}).`)
            }
        },
    }
}

export default HoneytokenProtection

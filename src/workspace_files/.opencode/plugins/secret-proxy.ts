import type { Plugin } from "@opencode-ai/plugin"

function getApiBaseUrl(): string {
  const port = process.env.TEAMCOPILOT_PORT?.trim()
  if (!port) {
    throw new Error("TEAMCOPILOT_PORT must be set.")
  }
  return `http://localhost:${port}`
}

interface SessionLookupResponse {
  error?: unknown
  data?: {
    id?: string
    parentID?: string
  }
}

async function readErrorMessageFromResponse(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return fallbackMessage
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        const msg = (parsed as { message?: unknown }).message
        if (typeof msg === "string" && msg.trim().length > 0) return msg
      }
    } catch {
      // fall back to plain text
    }
    return text.trim().length > 0 ? text : fallbackMessage
  } catch {
    return fallbackMessage
  }
}

type PlaceholderResolutionResponse = {
  referenced_keys?: string[]
  missing_keys?: string[]
  substituted_text?: string
}

export const SecretProxyPlugin: Plugin = async ({ client, directory }) => {
  async function resolveRootSessionID(sessionID: string): Promise<string> {
    let currentSessionID = sessionID

    while (true) {
      const response = (await client.session.get({
        path: {
          id: currentSessionID,
        },
      })) as SessionLookupResponse
      if (response.error) {
        throw new Error(`Failed to resolve root session for ${currentSessionID}`)
      }

      const parentID = response.data?.parentID
      if (!parentID) {
        return currentSessionID
      }

      currentSessionID = parentID
    }
  }

  async function substituteSecretPlaceholders(sessionID: string, command: string): Promise<string> {
    const rootSessionID = await resolveRootSessionID(sessionID)
    const response = await fetch(`${getApiBaseUrl()}/api/users/me/resolve-secret-placeholders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rootSessionID}`,
      },
      body: JSON.stringify({
        text: command,
      }),
    })

    if (!response.ok) {
      const errorMessage = await readErrorMessageFromResponse(
        response,
        `Failed to resolve secret placeholders for bash command (HTTP ${response.status})`
      )
      throw new Error(errorMessage)
    }

    const payload = (await response.json()) as PlaceholderResolutionResponse
    return typeof payload.substituted_text === "string" ? payload.substituted_text : command
  }

  return {
    "command.execute.before": async (input) => {
      if (typeof input.command !== "string" || input.command.trim() === "") {
        return
      }

      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      const fullCommand = [input.command, input.arguments].filter((value) => typeof value === "string" && value.trim() !== "").join(" ").trim()
      if (!fullCommand.includes("{{SECRET:")) {
        return
      }

      const substitutedCommand = await substituteSecretPlaceholders(sessionID, fullCommand)
      input.command = substitutedCommand
      input.arguments = ""
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return
      }

      const sessionID = typeof input.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) {
        return
      }

      const commandValue = typeof output.args?.command === "string" && output.args.command.trim() !== ""
        ? output.args.command
        : typeof output.args?.cmd === "string" && output.args.cmd.trim() !== ""
          ? output.args.cmd
          : typeof input.args?.command === "string" && input.args.command.trim() !== ""
            ? input.args.command
            : typeof input.args?.cmd === "string" && input.args.cmd.trim() !== ""
              ? input.args.cmd
              : ""

      if (!commandValue || !commandValue.includes("{{SECRET:")) {
        return
      }

      const substitutedCommand = await substituteSecretPlaceholders(sessionID, commandValue)
      if (typeof output.args?.command === "string") {
        output.args.command = substitutedCommand
        return
      }
      if (typeof output.args?.cmd === "string") {
        output.args.cmd = substitutedCommand
        return
      }
      if (input.args && typeof input.args.command === "string") {
        input.args.command = substitutedCommand
        return
      }
      if (input.args && typeof input.args.cmd === "string") {
        input.args.cmd = substitutedCommand
        return
      }
      output.args = {
        ...output.args,
        command: substitutedCommand,
        workdir: output.args?.workdir ?? output.args?.cwd ?? directory,
      }
    },
  }
}

export default SecretProxyPlugin

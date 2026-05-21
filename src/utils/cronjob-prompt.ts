const LEGACY_TODO_STEP_MARKER = "Todo steps to follow:";
const EXECUTION_STEPS_PAYLOAD_PREFIX = "<!-- TEAMCOPILOT_CRONJOB_TODO_STEPS:v1:";
const EXECUTION_STEPS_PAYLOAD_SUFFIX = " -->";

type ParsedCronjobPrompt = {
    prompt: string;
    executionSteps: string[];
};

function encodeUtf8ToBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function decodeBase64ToUtf8(value: string): string {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function parseExecutionStepsPayload(prompt: string): ParsedCronjobPrompt | null {
    if (!prompt.endsWith(EXECUTION_STEPS_PAYLOAD_SUFFIX)) {
        return null;
    }

    const payloadStart = prompt.lastIndexOf(EXECUTION_STEPS_PAYLOAD_PREFIX);
    if (payloadStart === -1) {
        return null;
    }

    const promptText = prompt.slice(0, payloadStart).trimEnd();
    const payload = prompt.slice(
        payloadStart + EXECUTION_STEPS_PAYLOAD_PREFIX.length,
        prompt.length - EXECUTION_STEPS_PAYLOAD_SUFFIX.length,
    ).trim();

    if (payload.length === 0) {
        return { prompt: promptText, executionSteps: [] };
    }

    try {
        const decodedPayload = decodeBase64ToUtf8(payload);
        const parsedPayload = JSON.parse(decodedPayload) as { executionSteps?: unknown };
        if (!Array.isArray(parsedPayload.executionSteps)) {
            return null;
        }

        return {
            prompt: promptText,
            executionSteps: parsedPayload.executionSteps.map((step) => {
                if (typeof step !== "string") {
                    throw new Error("Cronjob execution step payload must contain strings only");
                }
                return step;
            }),
        };
    } catch {
        return null;
    }
}

function parseCronjobPrompt(prompt: string): ParsedCronjobPrompt {
    const parsedPayload = parseExecutionStepsPayload(prompt);
    if (parsedPayload) {
        return parsedPayload;
    }

    const markerIndex = prompt.indexOf(LEGACY_TODO_STEP_MARKER);
    if (markerIndex === -1) {
        return { prompt: prompt.trim(), executionSteps: [] };
    }

    const promptText = prompt.slice(0, markerIndex).trimEnd();
    const rawSteps = prompt.slice(markerIndex + LEGACY_TODO_STEP_MARKER.length).trim();
    if (rawSteps.length === 0) {
        return { prompt: promptText, executionSteps: [] };
    }

    const executionSteps = rawSteps
        .split("\n")
        .map((line) => line.replace(/^- /, "").trim())
        .filter((line) => line.length > 0);

    return {
        prompt: promptText,
        executionSteps,
    };
}

function buildCronjobPromptWithExecutionSteps(prompt: string, executionSteps: string[]): string {
    const promptText = prompt.trim();
    const steps = executionSteps.map((step) => step.trim()).filter((step) => step.length > 0);

    if (steps.length === 0) {
        return promptText;
    }

    const promptSuffix = /[.?!]$/.test(promptText) ? "" : ".";
    const payload = encodeUtf8ToBase64(JSON.stringify({ executionSteps: steps }));
    return `${promptText}${promptSuffix}\n\n${EXECUTION_STEPS_PAYLOAD_PREFIX}${payload}${EXECUTION_STEPS_PAYLOAD_SUFFIX}`;
}

export const cronjobPrompt = {
    LEGACY_TODO_STEP_MARKER,
    parse: parseCronjobPrompt,
    buildWithExecutionSteps: buildCronjobPromptWithExecutionSteps,
};

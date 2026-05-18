const LEGACY_TODO_STEP_MARKER = "Todo steps to follow:";

type ParsedCronjobPrompt = {
    prompt: string;
    executionSteps: string[];
};

function parseCronjobPrompt(prompt: string): ParsedCronjobPrompt {
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
    return `${promptText}${promptSuffix} ${LEGACY_TODO_STEP_MARKER}\n- ${steps.join("\n- ")}`;
}

export const cronjobPrompt = {
    LEGACY_TODO_STEP_MARKER,
    parse: parseCronjobPrompt,
    buildWithExecutionSteps: buildCronjobPromptWithExecutionSteps,
};

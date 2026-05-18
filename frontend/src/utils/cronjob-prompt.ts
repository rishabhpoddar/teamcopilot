const TODO_STEP_MARKER = 'Todo steps to follow:';

export function parseCronjobPrompt(prompt: string): { prompt: string; executionSteps: string[] } {
    const markerIndex = prompt.indexOf(TODO_STEP_MARKER);
    if (markerIndex === -1) {
        return { prompt: prompt.trim(), executionSteps: [] };
    }

    const promptText = prompt.slice(0, markerIndex).trimEnd();
    const rawSteps = prompt.slice(markerIndex + TODO_STEP_MARKER.length).trim();
    if (rawSteps.length === 0) {
        return { prompt: promptText, executionSteps: [] };
    }

    const executionSteps = rawSteps
        .split('\n')
        .map((line) => line.replace(/^- /, '').trim())
        .filter((line) => line.length > 0);

    return {
        prompt: promptText,
        executionSteps,
    };
}

export function buildCronjobPromptWithExecutionSteps(prompt: string, executionSteps: string[]): string {
    const promptText = prompt.trim();
    const steps = executionSteps.map((step) => step.trim()).filter((step) => step.length > 0);

    if (steps.length === 0) {
        return promptText;
    }

    const promptSuffix = /[.?!]$/.test(promptText) ? '' : '.';
    return `${promptText}${promptSuffix} ${TODO_STEP_MARKER}\n- ${steps.join('\n- ')}`;
}

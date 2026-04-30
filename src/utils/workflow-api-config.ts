import { assertCondition, parseIntStrict, assertEnv } from './assert';

export function getWorkflowApiHost(): string {
    return process.env.WORKFLOW_API_HOST ?? assertEnv('TEAMCOPILOT_HOST');
}

export function getWorkflowApiPort(): number {
    if (process.env.WORKFLOW_API_PORT) {
        return parseIntStrict(process.env.WORKFLOW_API_PORT, "WORKFLOW_API_PORT");
    }
    const teamcopilotPort = parseIntStrict(assertEnv('TEAMCOPILOT_PORT'), "TEAMCOPILOT_PORT");
    return teamcopilotPort + 1;
}

export function getWorkflowApiBaseUrl(): string {
    const rawHost = getWorkflowApiHost();
    const host = rawHost.replace(/^https?:\/\//, "");
    assertCondition(host.length > 0, "WORKFLOW_API_HOST must not be empty");
    return `http://${host}:${getWorkflowApiPort()}`;
}

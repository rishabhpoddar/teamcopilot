import { assertCondition, assertEnv, parseIntStrict } from "./assert";

function normalizeExternalHost(raw: string): string {
    let value = raw.trim();
    value = value.replace(/^\/+/, "");
    value = value.replace(/\/+$/, "");
    assertCondition(value.length > 0, "EXTERNAL_HOST must not be empty");

    if (!/^https?:\/\//i.test(value)) {
        value = `http://${value}`;
    }

    const parsed = new URL(value);
    return parsed.toString().replace(/\/+$/, "");
}

export function getWorkflowApiBaseUrl(): string {
    const externalHost = process.env.EXTERNAL_HOST;
    const teamcopilotHost = assertEnv("TEAMCOPILOT_HOST");
    const teamcopilotPort = parseIntStrict(assertEnv("TEAMCOPILOT_PORT"), "TEAMCOPILOT_PORT");
    const hostForCurl = externalHost || `${teamcopilotHost}:${teamcopilotPort}`;
    return `${normalizeExternalHost(hostForCurl)}/api/workflow-api`;
}

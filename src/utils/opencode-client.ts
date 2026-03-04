import path from "path";
import { assertCondition, assertEnv, parseIntStrict } from "./assert";

// Use dynamic import for ESM-only SDK
let _createOpencodeClient: typeof import("@opencode-ai/sdk").createOpencodeClient | null = null;

async function loadSdk() {
    if (!_createOpencodeClient) {
        const sdk = await import("@opencode-ai/sdk");
        _createOpencodeClient = sdk.createOpencodeClient;
    }
    return _createOpencodeClient;
}

export async function getOpencodeClient() {
    const createOpencodeClient = await loadSdk();

    const port = parseIntStrict(assertEnv("OPENCODE_PORT"), "OPENCODE_PORT");

    // Get workspace directory from env, resolve relative paths to absolute
    let workspaceDir = assertEnv("WORKSPACE_DIR");
    if (!path.isAbsolute(workspaceDir)) {
        workspaceDir = path.resolve(process.cwd(), workspaceDir);
    }

    return createOpencodeClient({
        baseUrl: `http://localhost:${port}`,
        directory: workspaceDir
    });
}

export function getOpencodePort(): number {
    return parseIntStrict(assertEnv("OPENCODE_PORT"), "OPENCODE_PORT");
}

function getOpencodeBaseUrl(): string {
    return `http://localhost:${getOpencodePort()}`;
}

interface PendingQuestion {
    id: string;
    sessionID: string;
    questions: Array<unknown>;
}

interface PendingPermission {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
    always: string[];
    tool?: {
        messageID: string;
        callID: string;
    };
}

export function getWorkspaceDir(): string {
    let workspaceDir = assertEnv("WORKSPACE_DIR");
    if (!path.isAbsolute(workspaceDir)) {
        workspaceDir = path.resolve(process.cwd(), workspaceDir);
    }
    return workspaceDir;
}

export async function getPendingQuestionForSession(opencodeSessionId: string): Promise<PendingQuestion | null> {
    const workspaceDir = getWorkspaceDir();
    const response = await fetch(
        `${getOpencodeBaseUrl()}/question?directory=${encodeURIComponent(workspaceDir)}`
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list pending questions: ${errorText}`);
    }

    const questions = await response.json() as PendingQuestion[];
    assertCondition(Array.isArray(questions), "Pending question response is not an array");

    const match = questions.find((question) => question.sessionID === opencodeSessionId);
    return match ?? null;
}

export async function listPendingPermissionForSession(opencodeSessionId: string): Promise<PendingPermission[]> {
    const permissions = await listPendingPermissions();
    const match = permissions.filter((permission) => permission.sessionID === opencodeSessionId);
    return match;
}

export async function listPendingPermissions(): Promise<PendingPermission[]> {
    const workspaceDir = getWorkspaceDir();
    const response = await fetch(
        `${getOpencodeBaseUrl()}/permission?directory=${encodeURIComponent(workspaceDir)}`
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list pending permissions: ${errorText}`);
    }

    const permissions = await response.json() as PendingPermission[];
    assertCondition(Array.isArray(permissions), "Pending permission response is not an array");
    return permissions;
}

export async function replyToPendingQuestion(questionId: string, answers: Array<Array<string>>): Promise<void> {
    const workspaceDir = getWorkspaceDir();
    const response = await fetch(
        `${getOpencodeBaseUrl()}/question/${encodeURIComponent(questionId)}/reply?directory=${encodeURIComponent(workspaceDir)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ answers })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to reply to pending question: ${errorText}`);
    }
}

export async function replyToPendingPermission(
    _opencodeSessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject"
): Promise<void> {
    const workspaceDir = getWorkspaceDir();
    const replyResponse = await fetch(
        `${getOpencodeBaseUrl()}/permission/${encodeURIComponent(permissionId)}/reply?directory=${encodeURIComponent(workspaceDir)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reply: response,
                message: response === "reject" ? "User rejected permission request" : "User approved permission request"
            })
        }
    );
    if (!replyResponse.ok) {
        const errorText = await replyResponse.text();
        throw new Error(`Failed to reply to pending permission: ${errorText}`);
    }
}

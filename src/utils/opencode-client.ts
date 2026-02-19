import path from "path";

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

    const port = parseInt(process.env.OPENCODE_PORT || "4096", 10);

    // Get workspace directory from env, resolve relative paths to absolute
    let workspaceDir = process.env.WORKSPACE_DIR!;
    if (!path.isAbsolute(workspaceDir)) {
        workspaceDir = path.resolve(process.cwd(), workspaceDir);
    }

    return createOpencodeClient({
        baseUrl: `http://localhost:${port}`,
        directory: workspaceDir
    });
}

export function getOpencodePort(): number {
    return parseInt(process.env.OPENCODE_PORT || "4096", 10);
}

export function getOpencodeBaseUrl(): string {
    return `http://localhost:${getOpencodePort()}`;
}

export interface PendingQuestion {
    id: string;
    sessionID: string;
    questions: Array<unknown>;
}

export function getWorkspaceDir(): string {
    let workspaceDir = process.env.WORKSPACE_DIR!;
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

    const questions = await response.json();
    if (!Array.isArray(questions)) {
        return null;
    }

    const match = questions.find((question: unknown) => {
        if (!question || typeof question !== 'object') {
            return false;
        }
        return (question as { sessionID?: string }).sessionID === opencodeSessionId;
    });

    return (match as PendingQuestion | undefined) || null;
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
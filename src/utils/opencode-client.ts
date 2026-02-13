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

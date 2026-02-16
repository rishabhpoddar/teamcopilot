// Use dynamic import for ESM-only SDK.
// The published SDK types in this repo's setup don't currently expose `createOpencodeClient`,
// so we keep the runtime import but type it loosely.
let sdkPromise: Promise<any> | null = null;
let opencodeClientPromise: Promise<any> | null = null;

async function loadSdk(): Promise<any> {
    if (!sdkPromise) {
        sdkPromise = import("@opencode-ai/sdk") as Promise<any>;
    }
    return sdkPromise;
}

export async function getOpencodeClient() {
    if (!opencodeClientPromise) {
        opencodeClientPromise = (async () => {
            const { createOpencodeClient } = await loadSdk();

            const port = parseInt(process.env.OPENCODE_PORT || "4096", 10);
            const workspaceDir = process.cwd();

            return createOpencodeClient({
                baseUrl: `http://localhost:${port}`,
                directory: workspaceDir,
            });
        })();
    }

    return opencodeClientPromise;
}

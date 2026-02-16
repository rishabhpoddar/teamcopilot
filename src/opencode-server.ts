type OpencodeServerInstance = {
    url: string;
    close(): void;
};

let server: OpencodeServerInstance | null = null;

async function loadCreateOpencodeServer() {
    const sdk = await import("@opencode-ai/sdk");
    return sdk.createOpencodeServer;
}

export async function startOpencodeServer() {
    if (server) {
        return server;
    }

    const createOpencodeServer = await loadCreateOpencodeServer();
    const port = parseInt(process.env.OPENCODE_PORT || "4096", 10);
    const model = process.env.OPENCODE_MODEL || "claude-sonnet-4-5-20250929";
    const fullModel = model.includes("/") ? model : `anthropic/${model}`;

    server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        config: {
            model: fullModel,
        },
    });

    console.log(`Opencode server running at ${server.url}`);
    return server;
}

export function stopOpencodeServer() {
    if (!server) {
        return;
    }

    try {
        server.close();
        console.log("Opencode server closed.");
    } catch (err) {
        console.error("Error closing opencode server:", err);
    } finally {
        server = null;
    }
}

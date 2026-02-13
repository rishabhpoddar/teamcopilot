import dotenv from 'dotenv';
dotenv.config();
import { createOpencodeServer } from "@opencode-ai/sdk"

let server: {
    url: string;
    close(): void;
} | null = null;

async function main() {
    const port = parseInt(process.env.OPENCODE_PORT || "4096", 10);
    const model = process.env.OPENCODE_MODEL || "claude-sonnet-4-5-20250929";

    server = await createOpencodeServer({
        hostname: "127.0.0.1", // fixed cause only the backend server should query it, and the backend server is running on the same machine
        port,
        config: {
            model,
        },
    });

    console.log(`Opencode server running at ${server.url}`);
}

function closeServer() {
    try {
        if (server && typeof server.close === "function") {
            server.close();
            console.log("Opencode server closed.");
        }
    } catch (err) {
        console.error("Error closing opencode server:", err);
    }
}

process.on("exit", () => {
    closeServer();
});

["SIGINT", "SIGTERM"].forEach((sig) => {
    process.on(sig, () => {
        closeServer();
        // give closeServer a moment, then exit
        process.exit(0);
    });
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    closeServer();
    process.exit(1);
});

main();
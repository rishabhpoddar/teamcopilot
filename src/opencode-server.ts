import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import { assertEnv, assertCondition, parseIntStrict } from "./utils/assert";
import { syncManagedProviderConfiguration } from "./utils/opencode-auth";

const execAsync = promisify(exec);

type OpencodeServerInstance = {
    url: string;
    close(): void;
};

let server: OpencodeServerInstance | null = null;

function ensureLocalNodeBinInPath(): void {
    const localBin = path.resolve(__dirname, "../node_modules/.bin");
    const currentPath = process.env.PATH || "";
    const entries = currentPath.split(":");
    if (!entries.includes(localBin)) {
        process.env.PATH = `${localBin}:${currentPath}`;
    }
}

async function loadCreateOpencodeServer() {
    ensureLocalNodeBinInPath();
    const sdk = await import("@opencode-ai/sdk");
    return sdk.createOpencodeServer;
}

async function killProcessOnPort(port: number): Promise<void> {
    try {
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
            console.log(`Killing process ${pid} on port ${port}`);
            await execAsync(`kill -9 ${pid}`);
        }
        // Give the OS a moment to release the port
        await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
        // No process found on port, or kill failed - that's fine
    }
}

export async function startOpencodeServer() {
    if (server) {
        return server;
    }

    await syncManagedProviderConfiguration();

    // Ensure plugins running inside opencode can resolve backend base URL from TEAMCOPILOT_PORT.
    process.env.TEAMCOPILOT_PORT = assertEnv("TEAMCOPILOT_PORT");

    const createOpencodeServer = await loadCreateOpencodeServer();
    const port = parseIntStrict(assertEnv("OPENCODE_PORT"), "OPENCODE_PORT");
    const model = assertEnv("OPENCODE_MODEL");
    if (!model.includes("/")) {
        throw new Error("OPENCODE_MODEL must be in the format of <model_owner>/<model_name>");
    }
    const fullModel = model;

    const startServer = async () => {
        return await createOpencodeServer({
            hostname: "127.0.0.1",
            port,
            config: {
                model: fullModel,
                autoupdate: false,
            },
        });
    };

    try {
        server = await startServer();
    } catch (err) {
        console.log(`Failed to start opencode server on port ${port}, attempting to kill existing process and retry...`);
        await killProcessOnPort(port);
        server = await startServer();
    }
    assertCondition(server, "Failed to initialize opencode server");

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

import { exec, execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { assertEnv, assertCondition, parseIntStrict } from "./utils/assert";
import { syncManagedProviderConfiguration } from "./utils/opencode-auth";
import {
    selectOpencodeNativeTarball,
    opencodeBinaryName,
    opencodeBinaryCachePaths,
} from "./utils/opencode-bin";

const execAsync = promisify(exec);

type OpencodeServerInstance = {
    url: string;
    close(): void;
};

let server: OpencodeServerInstance | null = null;

// The SDK starts opencode by spawning a bare `opencode` resolved through PATH.
// Both the opencode bin launcher and a parent/sibling project's `.bin/opencode`
// resolve the native binary by walking UP the directory tree for an
// `opencode-<platform>-<arch>` install, so an unrelated opencode in any ancestor
// node_modules shadows ours on every run — even after reinstalling. To stay
// immune we locate the binary belonging to *our* installed opencode-ai and force
// it to win resolution: its directory is prepended to PATH (so the bare
// `opencode` resolves straight to it) and OPENCODE_BIN_PATH is set as a fallback
// for launcher-based resolution.
function pinOpencodeBinaryPath(): void {
    // An explicit override (e.g. a local fork build) always wins.
    if (process.env.OPENCODE_BIN_PATH) {
        return;
    }

    // Resolve our own opencode-ai package (nearest in node_modules), never a parent's.
    const packageDir = path.dirname(require.resolve("opencode-ai/package.json"));
    const tarball = selectOpencodeNativeTarball({
        rawPlatform: os.platform(),
        rawArch: os.arch(),
        tarballNames: fs.readdirSync(packageDir),
        isMusl: os.platform() === "linux" && fs.existsSync("/etc/alpine-release"),
    });
    if (!tarball) {
        // No embedded native tarball for this platform; let the launcher decide.
        return;
    }

    // Mirror the launcher's cache layout so we reuse (or populate) the same binary.
    const { cacheDir, cacheBinDir, binaryPath: cachedBinary } = opencodeBinaryCachePaths({
        homeDir: os.homedir(),
        tarball,
        binaryName: opencodeBinaryName(os.platform()),
    });
    if (!fs.existsSync(cachedBinary)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.mkdirSync(cacheDir, { recursive: true });
        execFileSync("tar", ["-xzf", path.join(packageDir, tarball), "-C", cacheDir, "--strip-components=1"]);
    }

    // The SDK spawns a bare `opencode`, resolved via PATH. A parent/sibling's
    // `.bin/opencode` links straight to its own native binary and ignores
    // OPENCODE_BIN_PATH, so putting our binary's directory first on PATH is what
    // actually guarantees the right binary runs. OPENCODE_BIN_PATH is also set so
    // any launcher-based resolution still lands on the same binary.
    process.env.OPENCODE_BIN_PATH = cachedBinary;
    process.env.PATH = `${cacheBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
}

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

function forceStableOpencodeDatabasePath(): void {
    // Keep OpenCode on the workspace-wide database file even if a forked build
    // embeds a non-latest channel string.
    process.env.OPENCODE_DISABLE_CHANNEL_DB = "1";
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

    pinOpencodeBinaryPath();
    await syncManagedProviderConfiguration();
    forceStableOpencodeDatabasePath();

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
                tools: {
                    skill: false,
                },
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

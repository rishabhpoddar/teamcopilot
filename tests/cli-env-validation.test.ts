import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

const { REQUIRED_RUNTIME_ENV_KEYS, loadAndValidateLocalEnv } = require("../bin/teamcopilot.js") as {
    REQUIRED_RUNTIME_ENV_KEYS: string[];
    loadAndValidateLocalEnv: (envFilePath: string, workingDirectory: string) => Record<string, string>;
};

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cli-env-"));
}

function writeEnvFile(root: string, values: Record<string, string>): string {
    const envPath = path.join(root, ".env");
    const content = `${Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`;
    fs.writeFileSync(envPath, content, "utf-8");
    return envPath;
}

function assertThrowsMessage(fn: () => void, expectedMessage: string): void {
    let thrown: unknown;
    try {
        fn();
    } catch (error) {
        thrown = error;
    }

    assert(thrown instanceof Error, "Expected function to throw an Error");
    assert.strictEqual(thrown.message, expectedMessage);
}

function run(): void {
    assert.deepStrictEqual(REQUIRED_RUNTIME_ENV_KEYS, [
        "WORKSPACE_DIR",
        "TEAMCOPILOT_HOST",
        "TEAMCOPILOT_PORT",
        "OPENCODE_PORT",
        "OPENCODE_MODEL",
    ]);

    {
        const root = makeTempDir();
        const envPath = path.join(root, ".env");
        assertThrowsMessage(
            () => loadAndValidateLocalEnv(envPath, root),
            `No .env file found in ${root}. Run \`npx teamcopilot init\` first.`,
        );
    }

    {
        const root = makeTempDir();
        const envPath = writeEnvFile(root, {
            WORKSPACE_DIR: root,
            TEAMCOPILOT_HOST: "0.0.0.0",
            TEAMCOPILOT_PORT: "5124",
            OPENCODE_PORT: "4096",
        });
        assertThrowsMessage(
            () => loadAndValidateLocalEnv(envPath, root),
            "Missing required variables in .env: OPENCODE_MODEL. Run `npx teamcopilot init` first.",
        );
    }

    {
        const root = makeTempDir();
        const envPath = writeEnvFile(root, {
            WORKSPACE_DIR: root,
            TEAMCOPILOT_HOST: "0.0.0.0",
            TEAMCOPILOT_PORT: "5124",
            OPENCODE_PORT: "4096",
            OPENCODE_MODEL: "openai/gpt-5.3-codex",
        });
        const parsed = loadAndValidateLocalEnv(envPath, root);
        assert.strictEqual(parsed.OPENCODE_MODEL, "openai/gpt-5.3-codex");
    }

    {
        const root = makeTempDir();
        const envPath = writeEnvFile(root, {
            WORKSPACE_DIR: root,
            TEAMCOPILOT_HOST: "0.0.0.0",
            TEAMCOPILOT_PORT: "5124",
            OPENCODE_PORT: "4096",
            OPENCODE_MODEL: "openai/gpt-5.3-codex",
            NPM_TOKEN: "token-only-for-release",
        });
        const parsed = loadAndValidateLocalEnv(envPath, root);
        assert.strictEqual(parsed.NPM_TOKEN, "token-only-for-release");
    }

    console.log("CLI env validation tests passed");
}

run();

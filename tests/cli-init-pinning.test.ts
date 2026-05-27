import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

const { getTeamCopilotInstallSpec } = require("../bin/teamcopilot.js") as {
    getTeamCopilotInstallSpec: (startDirectory?: string) => string;
};

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-cli-init-pinning-"));
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function run(): void {
    {
        const packageRoot = makeTempDir();
        const cliDir = path.join(packageRoot, "node_modules", "teamcopilot");
        fs.mkdirSync(cliDir, { recursive: true });
        writeJson(path.join(packageRoot, "package-lock.json"), {
            name: "npx-temp",
            lockfileVersion: 3,
            packages: {
                "": {
                    dependencies: {
                        teamcopilot: "0.4.15",
                    },
                },
                "node_modules/teamcopilot": {
                    version: "0.4.15",
                    resolved: "https://registry.npmjs.org/teamcopilot/-/teamcopilot-0.4.15.tgz",
                },
            },
        });

        assert.strictEqual(getTeamCopilotInstallSpec(cliDir), "0.4.15");
    }

    {
        const packageRoot = makeTempDir();
        const cliDir = path.join(packageRoot, "node_modules", "teamcopilot");
        fs.mkdirSync(cliDir, { recursive: true });
        const localTarball = path.join(path.dirname(packageRoot), "teamcopilot-0.4.15.tgz");
        const relativeTarballPath = path.relative(packageRoot, localTarball);
        writeJson(path.join(packageRoot, "package-lock.json"), {
            name: "npx-temp",
            lockfileVersion: 3,
            packages: {
                "": {
                    dependencies: {
                        teamcopilot: `file:${relativeTarballPath}`,
                    },
                },
                "node_modules/teamcopilot": {
                    version: "0.4.15",
                    resolved: `file:${relativeTarballPath}`,
                },
            },
        });
        fs.writeFileSync(localTarball, "dummy tarball", "utf-8");

        assert.strictEqual(
            getTeamCopilotInstallSpec(cliDir),
            pathToFileUrl(localTarball),
        );
    }

    console.log("CLI init pinning tests passed");
}

function pathToFileUrl(filePath: string): string {
    const normalized = path.resolve(filePath);
    return `file://${normalized}`;
}

run();

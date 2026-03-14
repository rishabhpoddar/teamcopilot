#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createInterface } = require("node:readline/promises");
const dotenv = require("dotenv");

const packageRoot = path.resolve(__dirname, "..");
const currentDirectory = process.cwd();
const envExamplePath = path.join(packageRoot, ".env.example");
const envFilePath = path.join(currentDirectory, ".env");

const commandToScript = {
    start: "index.js",
    "create-user": "create-user.js",
    "delete-user": "delete-user.js",
    "change-user-role": "change-user-role.js",
    "reset-password": "reset-password.js",
    "rotate-jwt-secret": "rotate-jwt-secret.js",
    prisma: path.join("scripts", "prisma-workspace.js"),
};

function printHelp() {
    console.error(`Usage:
  npx teamcopilot init [options]
  npx teamcopilot start
  npx teamcopilot create-user [args]
  npx teamcopilot delete-user [args]
  npx teamcopilot change-user-role [args]
  npx teamcopilot reset-password [args]
  npx teamcopilot rotate-jwt-secret
  npx teamcopilot prisma -- <prisma args>

Init options:
  --workspace-dir <path>
  --teamcopilot-host <host>
  --teamcopilot-port <port>
  --opencode-port <port>
  --opencode-model <model>
`);
}

function loadEnvExample() {
    const parsed = dotenv.parse(fs.readFileSync(envExamplePath, "utf-8"));
    return parsed;
}

function normalizeInitFlag(flagName) {
    return flagName.replace(/^--/, "").trim().toUpperCase().replace(/-/g, "_");
}

function serializeEnvValue(value) {
    if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}

function parseFlags(argv) {
    const flags = new Map();
    const passthrough = [];

    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith("--")) {
            passthrough.push(value);
            continue;
        }

        if (value === "--") {
            passthrough.push(...argv.slice(index));
            break;
        }

        const equalsIndex = value.indexOf("=");
        if (equalsIndex >= 0) {
            const key = normalizeInitFlag(value.slice(0, equalsIndex));
            flags.set(key, value.slice(equalsIndex + 1));
            continue;
        }

        const nextValue = argv[index + 1];
        if (!nextValue || nextValue.startsWith("--")) {
            throw new Error(`Missing value for ${value}`);
        }
        flags.set(normalizeInitFlag(value), nextValue);
        index += 1;
    }

    return { flags, passthrough };
}

function validateInitValue(key, rawValue) {
    const value = rawValue.trim();
    if (value.length === 0) {
        throw new Error(`${key} cannot be empty`);
    }

    if (key === "WORKSPACE_DIR") {
        return path.resolve(currentDirectory, value);
    }

    if (key === "TEAMCOPILOT_PORT" || key === "OPENCODE_PORT") {
        const parsedPort = Number(value);
        if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
            throw new Error(`${key} must be an integer between 1 and 65535`);
        }
        return String(parsedPort);
    }

    return value;
}

function parseExistingEnv() {
    if (!fs.existsSync(envFilePath)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(envFilePath, "utf-8"));
}

async function promptForEnvValues(defaultValues, existingValues, providedFlags) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        const resolvedValues = {};
        for (const key of Object.keys(defaultValues)) {
            const providedValue = providedFlags.get(key);
            if (providedValue !== undefined) {
                resolvedValues[key] = validateInitValue(key, providedValue);
                continue;
            }

            const displayedDefault = existingValues[key] ?? defaultValues[key];
            while (true) {
                const answer = await rl.question(`${key} [${displayedDefault}]: `);
                const candidate = answer.trim().length === 0 ? displayedDefault : answer;
                try {
                    resolvedValues[key] = validateInitValue(key, candidate);
                    break;
                } catch (error) {
                    console.error(error.message);
                }
            }
        }
        return resolvedValues;
    } finally {
        rl.close();
    }
}

function upsertEnvFile(values) {
    const existingContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, "utf-8") : "";
    const lines = existingContent.length > 0 ? existingContent.split(/\r?\n/) : [];
    const nextLines = [...lines];
    const updatedKeys = new Set();

    for (let index = 0; index < nextLines.length; index += 1) {
        const line = nextLines[index];
        const match = /^([A-Z0-9_]+)=.*$/.exec(line);
        if (!match) {
            continue;
        }

        const key = match[1];
        if (!(key in values)) {
            continue;
        }

        nextLines[index] = `${key}=${serializeEnvValue(values[key])}`;
        updatedKeys.add(key);
    }

    for (const [key, value] of Object.entries(values)) {
        if (!updatedKeys.has(key)) {
            nextLines.push(`${key}=${serializeEnvValue(value)}`);
        }
    }

    const serialized = `${nextLines.join("\n").replace(/\n*$/, "\n")}`;
    fs.writeFileSync(envFilePath, serialized, "utf-8");
}

function loadAndValidateLocalEnv() {
    if (!fs.existsSync(envFilePath)) {
        throw new Error(`No .env file found in ${currentDirectory}. Run \`npx teamcopilot init\` first.`);
    }

    const parsedEnv = dotenv.parse(fs.readFileSync(envFilePath, "utf-8"));
    const requiredKeys = Object.keys(loadEnvExample());
    const missingKeys = requiredKeys.filter((key) => {
        const value = parsedEnv[key];
        return typeof value !== "string" || value.trim().length === 0;
    });

    if (missingKeys.length > 0) {
        throw new Error(`Missing required variables in .env: ${missingKeys.join(", ")}. Run \`npx teamcopilot init\` first.`);
    }

    return parsedEnv;
}

function runCompiledCommand(command, argv, envValues) {
    const relativeScriptPath = commandToScript[command];
    if (!relativeScriptPath) {
        throw new Error(`Unknown command: ${command}`);
    }

    const scriptPath = path.join(packageRoot, "dist", relativeScriptPath);
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Built script not found: ${scriptPath}. Rebuild the package before publishing.`);
    }

    const child = spawn(process.execPath, [scriptPath, ...argv], {
        cwd: currentDirectory,
        stdio: "inherit",
        env: {
            ...process.env,
            ...envValues,
        },
    });

    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
}

async function runInit(argv) {
    const { flags, passthrough } = parseFlags(argv);
    if (passthrough.length > 0) {
        throw new Error(`Unexpected positional arguments for init: ${passthrough.join(" ")}`);
    }
    const defaultValues = {
        ...loadEnvExample(),
        WORKSPACE_DIR: currentDirectory,
    };
    const allowedKeys = new Set(Object.keys(defaultValues));
    for (const key of flags.keys()) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unknown init option: --${key.toLowerCase().replace(/_/g, "-")}`);
        }
    }
    const existingValues = parseExistingEnv();
    const values = await promptForEnvValues(defaultValues, existingValues, flags);
    upsertEnvFile(values);
    console.log(`Wrote ${envFilePath}`);
}

async function main() {
    const [command, ...argv] = process.argv.slice(2);

    if (!command || command === "--help" || command === "-h" || command === "help") {
        printHelp();
        process.exit(command ? 0 : 1);
    }

    if (command === "init") {
        await runInit(argv);
        return;
    }

    if (!(command in commandToScript)) {
        printHelp();
        throw new Error(`Unknown command: ${command}`);
    }

    const envValues = loadAndValidateLocalEnv();
    runCompiledCommand(command, argv, envValues);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});

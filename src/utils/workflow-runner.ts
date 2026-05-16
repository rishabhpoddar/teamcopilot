// @ts-nocheck
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import prisma from "../prisma/client";
import { isWorkflowSessionInterrupted } from "./workflow-interruption";
import { normalizeSecretKeyList, resolveGlobalSecrets, resolveSecretsForUser } from "./secrets";
import { validateWorkflowSecretContract } from "./secret-contract-validation";

const MAX_OUTPUT_CHARS = 300_000;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isPathInside(childPath: string, parentPath: string): boolean {
    const parent = path.resolve(parentPath) + path.sep;
    const child = path.resolve(childPath) + path.sep;
    return child.startsWith(parent);
}

function getVenvPythonPath(workflowPath: string): string {
    return path.join(workflowPath, ".venv", "bin", "python");
}

function getVenvBinDir(workflowPath: string): string {
    return path.join(workflowPath, ".venv", "bin");
}

async function assertPathExists(p: string): Promise<void> {
    await fsp.access(p);
}

async function assertDirectory(p: string): Promise<void> {
    const stats = await fsp.stat(p);
    if (!stats.isDirectory()) {
        throw new Error(`Expected directory at ${p}`);
    }
}

async function assertVenvExists(workflowPath: string): Promise<void> {
    const venvPath = path.join(workflowPath, ".venv");
    const stats = await fsp.stat(venvPath);
    if (!stats.isDirectory()) {
        throw new Error(`Virtual environment path is not a directory: ${venvPath}`);
    }
}

function parseTimeoutSeconds(raw: unknown): number | null {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    if (raw <= 0) return null;
    return Math.min(Math.floor(raw), 24 * 60 * 60);
}

function coerceBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(v)) return true;
    if (["false", "0", "no", "n", "off"].includes(v)) return false;
    return null;
}

function coerceNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}

function validateInputs(providedInputs: Record<string, unknown>, schema: Record<string, any>) {
    const errors: string[] = [];
    const processedInputs: Record<string, string | number | boolean> = {};

    for (const [name, config] of Object.entries(schema)) {
        const value = providedInputs[name];
        if (value === undefined || value === null) {
            if (config.required !== false && config.default === undefined) {
                errors.push(`Missing required input: '${name}'`);
                continue;
            }
            if (config.default !== undefined) {
                processedInputs[name] = config.default as string | number | boolean;
            }
            continue;
        }

        let isValid = false;
        let processedValue: string | number | boolean | null = null;
        switch (config.type) {
            case "string":
                if (typeof value === "string") {
                    processedValue = value;
                    isValid = true;
                } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
                    processedValue = String(value);
                    isValid = true;
                }
                break;
            case "number":
                {
                    const coerced = coerceNumber(value);
                    if (coerced !== null) {
                        processedValue = coerced;
                        isValid = true;
                    }
                }
                break;
            case "boolean":
                {
                    const coerced = coerceBoolean(value);
                    if (coerced !== null) {
                        processedValue = coerced;
                        isValid = true;
                    }
                }
                break;
            default:
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                    processedValue = value;
                    isValid = true;
                }
        }

        if (!isValid) {
            errors.push(`Invalid type for '${name}': expected ${config.type}, got ${typeof value}`);
        } else {
            processedInputs[name] = processedValue as string | number | boolean;
        }
    }

    for (const name of Object.keys(providedInputs)) {
        if (!(name in schema)) {
            errors.push(`Unexpected input: '${name}' is not defined in workflow.json`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        processedInputs
    };
}

function inputsToArgs(inputs: Record<string, string | number | boolean>): string[] {
    const args: string[] = [];
    for (const [name, value] of Object.entries(inputs)) {
        const argName = `--${name}`;
        if (typeof value === "boolean") {
            if (value) {
                args.push(argName);
            }
        } else {
            args.push(argName, String(value));
        }
    }
    return args;
}

async function requestWorkflowPermission(opencodeSessionId: string, messageId: string, callId: string): Promise<void> {
    const permission = await prisma.tool_execution_permissions.create({
        data: {
            opencode_session_id: opencodeSessionId,
            message_id: messageId,
            call_id: callId,
            status: "pending",
            created_at: BigInt(Date.now())
        }
    });

    const maxAttempts = 300;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const latest = await prisma.tool_execution_permissions.findUnique({
            where: { id: permission.id }
        });
        if (!latest) {
            throw new Error("Permission request not found");
        }
        if (latest.status === "approved") {
            return;
        }
        if (latest.status === "rejected") {
            throw new Error("User denied permission to run this workflow.");
        }
    }

    await prisma.tool_execution_permissions.update({
        where: { id: permission.id },
        data: {
            status: "rejected",
            responded_at: BigInt(Date.now())
        }
    });
    throw new Error("Permission request timed out");
}

type RunWithTimeoutResult = {
    status: "success" | "error" | "timeout" | "aborted";
    output: string;
};

function runWithTimeout(
    workflowPath: string,
    args: string[],
    timeoutSeconds: number,
    outputFilePath: string,
    shouldAbort: () => Promise<boolean>,
    resolvedSecretMap: Record<string, string>
): Promise<RunWithTimeoutResult> {
    return new Promise((resolve) => {
        const venvPython = getVenvPythonPath(workflowPath);
        const runScript = path.join(workflowPath, "run.py");
        const venvBinDir = getVenvBinDir(workflowPath);

        let output = "";
        let outputTruncated = false;
        let finished = false;
        const outputFileStream = createWriteStream(outputFilePath, { flags: "a", encoding: "utf-8" });

        const appendOutput = (text: string) => {
            if (finished || outputTruncated) return;
            const remaining = MAX_OUTPUT_CHARS - output.length;
            if (remaining <= 0) {
                outputTruncated = true;
                output += `\n[WARN] Output truncated after ${MAX_OUTPUT_CHARS} characters\n`;
                return;
            }
            if (text.length <= remaining) {
                output += text;
                return;
            }
            output += text.slice(0, remaining);
            outputTruncated = true;
            output += `\n[WARN] Output truncated after ${MAX_OUTPUT_CHARS} characters\n`;
        };

        const child = spawn(venvPython, ["-u", runScript, ...args], {
            cwd: workflowPath,
            env: {
                ...process.env,
                ...resolvedSecretMap,
                PYTHONUNBUFFERED: "1",
                VIRTUAL_ENV: path.join(workflowPath, ".venv"),
                PATH: [venvBinDir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        });

        const pid = child.pid;
        const cleanup = (signal: NodeJS.Signals = "SIGTERM") => {
            if (!pid) return;
            try {
                process.kill(-pid, signal);
            } catch {
                // ignore
            }
        };

        const finalize = (status: "success" | "error" | "timeout" | "aborted") => {
            if (finished) return;
            finished = true;
            if (abortPollId) {
                clearInterval(abortPollId);
                abortPollId = null;
            }
            outputFileStream.end();
            resolve({ status, output });
        };

        child.stdout?.on("data", (data: Buffer) => {
            const text = data.toString();
            appendOutput(text);
            outputFileStream.write(text);
        });

        child.stderr?.on("data", (data: Buffer) => {
            const text = data.toString();
            appendOutput(text);
            outputFileStream.write(text);
        });

        let abortPollInFlight = false;
        let abortPollId: NodeJS.Timeout | null = null;
        abortPollId = setInterval(async () => {
            if (finished || abortPollInFlight) return;
            abortPollInFlight = true;
            let abortRequested = false;
            try {
                abortRequested = await shouldAbort();
            } catch {
                abortRequested = false;
            } finally {
                abortPollInFlight = false;
            }
            if (!abortRequested || finished) return;
            cleanup("SIGTERM");
            setTimeout(() => cleanup("SIGKILL"), 1000);
            const message = "\n[ERROR] Workflow execution was aborted\n";
            appendOutput(message);
            outputFileStream.write(message);
            finalize("aborted");
        }, 500);

        const timeoutId = setTimeout(() => {
            cleanup("SIGTERM");
            setTimeout(() => cleanup("SIGKILL"), 1000);
            const timeoutMessage = `\n[ERROR] Workflow execution timed out after ${timeoutSeconds} seconds\n`;
            appendOutput(timeoutMessage);
            outputFileStream.write(timeoutMessage);
            finalize("timeout");
        }, timeoutSeconds * 1000);

        child.on("close", (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                finalize("success");
                return;
            }
            if (code !== null) {
                appendOutput(`\n[ERROR] Process exited with code ${code}\n`);
                finalize("error");
                return;
            }
            finalize("error");
        });

        child.on("error", (err) => {
            clearTimeout(timeoutId);
            appendOutput(`\n[ERROR] Failed to start process: ${err.message}\n`);
            outputFileStream.write(`\n[ERROR] Failed to start process: ${err.message}\n`);
            finalize("error");
        });
    });
}

export async function startWorkflowRunViaBackend(options: {
    workspaceDir: string;
    slug: string;
    inputs: Record<string, unknown>;
    authUserId: string | null;
    sessionId: string;
    messageId: string;
    callId: string;
    requirePermissionPrompt: boolean;
    secretResolutionMode: "user" | "global";
    runSource: "user" | "api" | "cronjob";
    workflowApiKeyId?: string | null;
}): Promise<{ runId: string; timeoutSeconds: number; completion: Promise<{ status: string; output: string }> }> {
    if (!SLUG_REGEX.test(options.slug)) {
        throw new Error("Invalid workflow slug. Expected lowercase letters/numbers with optional hyphens.");
    }

    const workflowsRoot = path.join(options.workspaceDir, "workflows");
    const workflowPath = path.join(workflowsRoot, options.slug);
    if (!isPathInside(workflowPath, workflowsRoot)) {
        throw new Error("Invalid workflow path (must be inside workflows/).");
    }

    await assertDirectory(workflowPath);
    const runPyPath = path.join(workflowPath, "run.py");
    await assertPathExists(runPyPath);
    await assertVenvExists(workflowPath);
    await assertPathExists(getVenvPythonPath(workflowPath));

    if (options.requirePermissionPrompt) {
        await requestWorkflowPermission(options.sessionId, options.messageId, options.callId);
    }

    const workflowJsonContent = await fsp.readFile(path.join(workflowPath, "workflow.json"), "utf-8");
    const runPyContent = await fsp.readFile(runPyPath, "utf-8");
    validateWorkflowSecretContract({
        workflowJsonContent,
        runPyContent,
    });

    const workflowJson = JSON.parse(workflowJsonContent) as {
        inputs?: Record<string, any>;
        required_secrets?: string[];
        runtime?: { timeout_seconds?: number };
    };
    const inputSchema = workflowJson.inputs || {};
    const requiredSecrets = normalizeSecretKeyList(workflowJson.required_secrets);
    const validation = validateInputs(options.inputs, inputSchema);
    if (!validation.valid) {
        throw new Error(`Input validation failed: ${JSON.stringify(validation.errors)}`);
    }

    const secretResolutionMode = options.secretResolutionMode;
    if (secretResolutionMode === "user" && !options.authUserId) {
        throw new Error("authUserId is required for user secret resolution.");
    }
    const secretResolution = secretResolutionMode === "global"
        ? await resolveGlobalSecrets(requiredSecrets)
        : await resolveSecretsForUser(options.authUserId!, requiredSecrets);
    if (secretResolution.missingKeys.length > 0) {
        const secretLocation = secretResolutionMode === "global" ? "global secrets" : "your profile secrets";
        throw new Error(`Missing required secrets: ${secretResolution.missingKeys.join(", ")}. Add these keys in ${secretLocation} before running this workflow.`);
    }

    const timeoutSeconds = parseTimeoutSeconds(workflowJson.runtime?.timeout_seconds);
    if (!timeoutSeconds) {
        throw new Error(`Could not read runtime.timeout_seconds from workflow.json for '${options.slug}'`);
    }
    const cmdArgs = inputsToArgs(validation.processedInputs);

    const createdRun = await prisma.workflow_runs.create({
        data: {
            workflow_slug: options.slug,
            ran_by_user_id: options.authUserId,
            status: "running",
            started_at: BigInt(Date.now()),
            args: JSON.stringify(options.inputs),
            session_id: options.sessionId,
            message_id: options.messageId,
            run_source: options.runSource,
            workflow_api_key_id: options.workflowApiKeyId ?? null,
        }
    });
    const workflowRunsDir = path.join(options.workspaceDir, "workflow-runs");
    await fsp.mkdir(workflowRunsDir, { recursive: true });
    const outputFilePath = path.join(
        workflowRunsDir,
        `${sanitizeFilenamePart(options.sessionId)}-${sanitizeFilenamePart(options.messageId)}.txt`
    );
    await fsp.writeFile(outputFilePath, "", "utf-8");

    const completion = (async () => {
        const runResult = await runWithTimeout(
            workflowPath,
            cmdArgs,
            timeoutSeconds,
            outputFilePath,
            async () => {
                return await isWorkflowSessionInterrupted(options.sessionId, options.workspaceDir);
            },
            secretResolution.secretMap
        );
        const finalStatus = runResult.status === "success" ? "success" : "failed";

        await prisma.workflow_runs.update({
            where: { id: createdRun.id },
            data: {
                status: finalStatus,
                completed_at: BigInt(Date.now()),
                error_message: runResult.status === "success" ? null : runResult.output.slice(-1000),
                output: runResult.output,
            }
        });

        return {
            status: runResult.status,
            output: runResult.output
        };
    })();

    return { runId: createdRun.id, timeoutSeconds, completion };
}

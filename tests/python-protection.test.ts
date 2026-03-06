import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ToolCase = {
    kind: "tool";
    input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> };
    output: { args: Record<string, unknown> };
};

type CommandCase = {
    kind: "command";
    input: { command: string; arguments: string; sessionID: string };
    output: { parts: unknown[] };
};

type PluginCase = ToolCase | CommandCase;

type PluginResult = {
    blocked: boolean;
    message: string;
};

const WORKFLOW_SLUG = "print-numbers-1-50";
const WORKFLOW_SCRIPT = "for i in range(1, 51):\n    print(i)\n";

async function ensureRepoWorkflowFixture(): Promise<() => Promise<void>> {
    const repoWorkflowDir = path.resolve(process.cwd(), "src/workspace_files/workflows", WORKFLOW_SLUG);
    const repoRunPy = path.join(repoWorkflowDir, "run.py");

    try {
        await fs.access(repoRunPy);
        return async () => { };
    } catch {
        await fs.mkdir(repoWorkflowDir, { recursive: true });
        await fs.writeFile(repoRunPy, WORKFLOW_SCRIPT, "utf8");

        return async () => {
            await fs.rm(repoRunPy, { force: true });
            try {
                const remaining = await fs.readdir(repoWorkflowDir);
                if (remaining.length === 0) {
                    await fs.rm(repoWorkflowDir, { recursive: true, force: true });
                }
            } catch {
                // Ignore cleanup errors.
            }
        };
    }
}

async function createFixture(): Promise<{
    root: string;
    workflowDir: string;
    matchingDir: string;
    differentDir: string;
}> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "python-protection-"));
    const workflowsDir = path.join(root, "workflows");
    const workflowDir = path.join(workflowsDir, "print-numbers-1-50");
    const matchingDir = path.join(root, "scripts-matching");
    const differentDir = path.join(root, "scripts-different");

    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(matchingDir, { recursive: true });
    await fs.mkdir(differentDir, { recursive: true });

    await fs.writeFile(path.join(workflowDir, "run.py"), WORKFLOW_SCRIPT, "utf8");
    await fs.writeFile(path.join(matchingDir, "run.py"), WORKFLOW_SCRIPT, "utf8");
    await fs.writeFile(path.join(differentDir, "run.py"), "print('different script')\n", "utf8");

    return { root, workflowDir, matchingDir, differentDir };
}

function runPluginCase(workspaceRoot: string, pluginCase: PluginCase): PluginResult {
    const pluginFile = path.resolve(process.cwd(), "src/workspace_files/.opencode/plugins/python-protection.ts");
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.PYTHON_PROTECTION_PLUGIN_PATH;
const workspaceRoot = process.env.PYTHON_PROTECTION_WORKSPACE_ROOT;
const payload = JSON.parse(process.env.PYTHON_PROTECTION_CASE_JSON || "{}");
const mod = await import(pluginPath);
const hooks = await mod.PythonProtection({
  directory: workspaceRoot,
  worktree: workspaceRoot,
  client: {},
  project: {},
  $: {},
  serverUrl: new URL("http://localhost")
});
try {
  if (payload.kind === "tool") {
    await hooks["tool.execute.before"](payload.input, payload.output);
  } else {
    await hooks["command.execute.before"](payload.input, payload.output);
  }
  console.log(JSON.stringify({ blocked: false, message: "allowed" }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ blocked: true, message }));
}
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                PYTHON_PROTECTION_PLUGIN_PATH: pluginUrl,
                PYTHON_PROTECTION_WORKSPACE_ROOT: workspaceRoot,
                PYTHON_PROTECTION_CASE_JSON: JSON.stringify(pluginCase),
            },
        },
    );

    if (result.status !== 0) {
        throw new Error(
            `Subprocess failed (${result.status}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    }

    const lines = (result.stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
    assert.ok(jsonLine, `Missing JSON output from subprocess.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    return JSON.parse(jsonLine) as PluginResult;
}

function assertBlocked(result: PluginResult, label: string): void {
    assert.equal(result.blocked, true, label);
    assert.ok(result.message.includes("Direct workflow execution via Python is not allowed"), label);
}

function assertAllowed(result: PluginResult, label: string): void {
    assert.equal(result.blocked, false, label);
}

async function main(): Promise<void> {
    const cleanupRepoFixture = await ensureRepoWorkflowFixture();
    const fixture = await createFixture();
    try {
        assertBlocked(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c1" },
                output: { args: { command: "python3 run.py", workdir: fixture.workflowDir } },
            }),
            "Blocks python3 run.py in workflow directory",
        );

        assertBlocked(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c2" },
                output: { args: { command: "python run.py", workdir: fixture.matchingDir } },
            }),
            "Blocks non-workflow run.py when content matches a workflow run.py",
        );

        assertAllowed(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c3" },
                output: { args: { command: "python run.py", workdir: fixture.differentDir } },
            }),
            "Allows non-workflow run.py with different content",
        );

        assertBlocked(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c4" },
                output: { args: { command: `python ${path.join(fixture.workflowDir, "run.py")}` } },
            }),
            "Blocks absolute workflow run.py execution",
        );

        assertBlocked(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c5" },
                output: { args: { cmd: "cd workflows/print-numbers-1-50 && python run.py", cwd: fixture.root } },
            }),
            "Blocks chained cd + python run.py",
        );

        assertBlocked(
            runPluginCase(fixture.root, {
                kind: "command",
                input: { command: "cd workflows/print-numbers-1-50 && python", arguments: "run.py", sessionID: "s1" },
                output: { parts: [] },
            }),
            "Blocks command.execute.before path",
        );

        assertAllowed(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c6" },
                output: { args: { command: "python -m pip --version", workdir: fixture.root } },
            }),
            "Allows non-run.py Python command",
        );

        assertAllowed(
            runPluginCase(fixture.root, {
                kind: "tool",
                input: { tool: "bash", sessionID: "s1", callID: "c7" },
                output: { args: { command: "node -v", workdir: fixture.root } },
            }),
            "Allows non-Python command",
        );

        console.log("Python protection tests passed: 8");
    } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
        await cleanupRepoFixture();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

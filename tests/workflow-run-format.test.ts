import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function main(): void {
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "frontend/src/utils/run-format.ts")).href;
    const script = `
import { formatWorkflowRunRunner } from ${JSON.stringify(moduleUrl)};

function run(overrides) {
  return {
    id: "run-1",
    workflow_slug: "demo",
    ran_by_user_id: null,
    status: "success",
    started_at: 1,
    completed_at: 2,
    args: "{}",
    error_message: null,
    output: "ok",
    run_source: "user",
    user: null,
    workflow_api_key_id: null,
    ...overrides,
  };
}

const results = [
  formatWorkflowRunRunner(run({ run_source: "cronjob", user: { name: "Rishabh", email: "r@example.com" } })),
  formatWorkflowRunRunner(run({ run_source: "cronjob", user: null })),
  formatWorkflowRunRunner(run({ run_source: "api", user: null })),
  formatWorkflowRunRunner(run({ run_source: "user", user: { name: "Rishabh", email: "r@example.com" } })),
  formatWorkflowRunRunner(run({ run_source: "user", user: { name: "Rishabh", email: "r@example.com" } }), { includeEmailForUserRuns: true }),
  formatWorkflowRunRunner(run({ run_source: "user", user: null })),
];
console.log(JSON.stringify(results));
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        { encoding: "utf8" },
    );
    if (result.status !== 0) {
        throw new Error(`Subprocess failed (${result.status}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    const jsonLine = [...lines].reverse().find((line) => line.startsWith("[") && line.endsWith("]"));
    assert.ok(jsonLine, `Missing JSON output from subprocess.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.deepEqual(JSON.parse(jsonLine), [
        "Cronjob (Rishabh)",
        "Cronjob",
        "Workflow API",
        "Rishabh",
        "Rishabh (r@example.com)",
        "Unknown",
    ]);

    console.log("Workflow run format tests passed");
}

main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function main(): void {
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "frontend/src/utils/cronjob-format.ts")).href;
    const script = `
import { cronjobRunSummaryText } from ${JSON.stringify(moduleUrl)};
console.log(JSON.stringify([
  cronjobRunSummaryText("Completed successfully"),
  cronjobRunSummaryText(""),
  cronjobRunSummaryText(null),
]));
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
        "Completed successfully",
        "",
        "Summary of result not available",
    ]);

    console.log("Cronjob format tests passed");
}

main();

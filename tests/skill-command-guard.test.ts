import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type NormalizeResult = {
    value: string;
};

function runNormalizeCase(command: unknown): string {
    const pluginFile = path.resolve(
        process.cwd(),
        "src/workspace_files/.opencode/plugins/skill-command-guard.ts",
    );
    const pluginUrl = pathToFileURL(pluginFile).href;

    const script = `
const pluginPath = process.env.SKILL_COMMAND_GUARD_PLUGIN_PATH;
const command = JSON.parse(process.env.SKILL_COMMAND_GUARD_COMMAND_JSON ?? "null");
const mod = await import(pluginPath);
console.log(JSON.stringify({ value: mod.normalizeCommandSlug(command) }));
`;

    const result = spawnSync(
        process.execPath,
        ["--loader", "ts-node/esm/transpile-only", "--input-type=module", "-e", script],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                SKILL_COMMAND_GUARD_PLUGIN_PATH: pluginUrl,
                SKILL_COMMAND_GUARD_COMMAND_JSON: JSON.stringify(command),
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

    return (JSON.parse(jsonLine) as NormalizeResult).value;
}

async function main(): Promise<void> {
    assert.equal(runNormalizeCase("/skill-name"), "skill-name");
    assert.equal(runNormalizeCase("//skill-name"), "skill-name");
    assert.equal(runNormalizeCase("/skill-name hahas jkna skja"), "skill-name");
    assert.equal(runNormalizeCase("/skill-name haha /skill2-name"), "skill-name");
    assert.equal(runNormalizeCase(" /skill-name   extra"), "skill-name");
    assert.equal(runNormalizeCase("skill-name"), "");
    assert.equal(runNormalizeCase(""), "");
    assert.equal(runNormalizeCase(undefined), "");
    assert.equal(runNormalizeCase({ command: "/skill-name" }), "");

    console.log("Skill command guard tests passed: 9");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

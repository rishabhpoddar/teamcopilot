import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldIgnoreRelativePath } from "../src/utils/approval-snapshot-common";
import { buildChatSessionFileDiffResponse } from "../src/utils/chat-session-file-diff";
import { collectCurrentSkillSnapshot } from "../src/utils/skill-approval-snapshot";

type Baseline = {
    relative_path: string;
    existed_at_baseline: boolean;
    content_kind: "text" | "binary" | "missing";
    text_content: string | null;
    binary_content: Uint8Array | null;
    size_bytes: number | null;
    content_sha256: string | null;
};

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-session-diff-ignore-"));
}

function writeFile(root: string, relativePath: string, content: string): void {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
}

function baseline(relativePath: string, oldContent: string): Baseline {
    return {
        relative_path: relativePath,
        existed_at_baseline: true,
        content_kind: "text",
        text_content: oldContent,
        binary_content: null,
        size_bytes: Buffer.byteLength(oldContent, "utf8"),
        content_sha256: "baseline-hash",
    };
}

function run(): void {
    assert.equal(shouldIgnoreRelativePath(".agents/skills/example/SKILL.md"), true);
    assert.equal(shouldIgnoreRelativePath(".agents/skills/example/SKILL.md", { allowTopLevelAgentsDirectory: true }), false);
    assert.equal(shouldIgnoreRelativePath(".agents/something/.env", { allowTopLevelAgentsDirectory: true }), true);
    assert.equal(shouldIgnoreRelativePath("nested/.agents/skills/example/SKILL.md", { allowTopLevelAgentsDirectory: true }), true);
    assert.equal(shouldIgnoreRelativePath(".git/config"), true);
    assert.equal(shouldIgnoreRelativePath("workflows/demo/data/output.json"), true);
    assert.equal(shouldIgnoreRelativePath("workflows/demo/run.py"), false);

    const workspaceRoot = makeWorkspace();
    const previousWorkspaceDir = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = workspaceRoot;

    try {
        writeFile(workspaceRoot, ".agents/skills/example/SKILL.md", "new visible content\n");
        writeFile(workspaceRoot, ".agents/something/.env", "SECRET=new\n");
        writeFile(workspaceRoot, ".git/config", "[core]\nrepositoryformatversion = 0\n");

        const diff = buildChatSessionFileDiffResponse([
            baseline(".agents/skills/example/SKILL.md", "old visible content\n"),
            baseline(".agents/something/.env", "SECRET=old\n"),
            baseline(".git/config", "[core]\nrepositoryformatversion = 1\n"),
        ]);

        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.modified, 1);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.files.length, 1);
        assert.equal(diff.files[0]?.path, ".agents/skills/example/SKILL.md");
        assert.equal(diff.files[0]?.status, "modified");

        writeFile(workspaceRoot, ".agents/skills/example/.agents/hidden.txt", "should stay ignored\n");
        const skillSnapshot = collectCurrentSkillSnapshot("example");

        assert.deepEqual(
            skillSnapshot.files.map((file) => file.relative_path),
            ["SKILL.md"],
        );

        const ignoredOnlyDiff = buildChatSessionFileDiffResponse([
            baseline(".git/config", "[core]\nrepositoryformatversion = 1\n"),
        ]);

        assert.equal(ignoredOnlyDiff.has_previous_snapshot, true);
        assert.equal(ignoredOnlyDiff.summary.added, 0);
        assert.equal(ignoredOnlyDiff.summary.modified, 0);
        assert.equal(ignoredOnlyDiff.summary.deleted, 0);
        assert.equal(ignoredOnlyDiff.files.length, 0);
    } finally {
        if (previousWorkspaceDir === undefined) {
            delete process.env.WORKSPACE_DIR;
        } else {
            process.env.WORKSPACE_DIR = previousWorkspaceDir;
        }
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }

    console.log("Session diff ignore rule tests passed");
}

run();
